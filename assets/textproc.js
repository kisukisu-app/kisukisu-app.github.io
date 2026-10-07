/* KisuKisu textproc: JavaScript port of tools/cleanup-train/textproc.py, which is itself a
   parity-checked port of the app's Kotlin textproc/ (TextProcessor.process). Only process()
   and what it calls are ported. Python's str regexes are Unicode-aware (\w, \b, \d), so every
   pattern goes through R(), which rewrites \w \W \b \d into Unicode classes under the u flag.
   Exposes KKText.process(raw, isCode) and KKText.explain(raw) (for the demo's strike-through). */
(function (root) {
  'use strict';
  const WC = '[\\p{L}\\p{N}_]', NWC = '[^\\p{L}\\p{N}_]';
  const BND = `(?:(?<=${WC})(?!${WC})|(?<!${WC})(?=${WC}))`;
  // rewrite Python-style escapes outside character classes; inside classes none of \w\W\b\d are used
  function conv(src) {
    let out = '', inCls = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === '\\') {
        const n = src[i + 1];
        if (!inCls && n === 'w') out += WC;
        else if (!inCls && n === 'W') out += NWC;
        else if (!inCls && n === 'b') out += BND;
        else if (!inCls && n === 'd') out += '\\p{Nd}';
        else out += c + n;
        i++; continue;
      }
      if (c === '[' && !inCls) inCls = true;
      else if (c === ']' && inCls) inCls = false;
      out += c;
    }
    return out;
  }
  const cache = new Map();
  function R(src, flags) {
    const k = flags + '\u0000' + src;
    let r = cache.get(k);
    if (!r) { r = new RegExp(conv(src), flags + 'u'); cache.set(k, r); }
    r.lastIndex = 0;
    return r;
  }
  const esc = s => s.replace(/[.*+?^${}()|[\]\\\/-]/g, '\\$&');
  // Python re.sub(pattern, fn|str, text, flags=I): all matches
  const sub = (src, rep, text, flags = '') => text.replace(R(src, 'g' + flags), rep);
  const ws = s => s.split(/\s+/u).filter(w => w);
  const isWs = c => /^\s$/u.test(c);
  // Python str.strip / lstrip / rstrip with a char set (or whitespace when chars is undefined)
  const inSet = (c, chars) => chars === undefined ? isWs(c) : chars.includes(c);
  function lstrip(s, chars) { const a = [...s]; let i = 0; while (i < a.length && inSet(a[i], chars)) i++; return a.slice(i).join(''); }
  function rstrip(s, chars) { const a = [...s]; let j = a.length; while (j > 0 && inSet(a[j - 1], chars)) j--; return a.slice(0, j).join(''); }
  const strip = (s, chars) => lstrip(rstrip(s, chars), chars);
  const first = s => { const a = [...s]; return a.length ? a[0] : ''; };
  const rest = s => [...s].slice(1).join('');
  const capFirst = s => s ? first(s).toUpperCase() + rest(s) : s;
  const isAlpha = c => /^\p{L}$/u.test(c);
  const isLowerChar = c => c !== '' && c.toLowerCase() === c && c.toUpperCase() !== c;
  const g = (m, i) => m[i] === undefined ? null : m[i];

  // ------------------------------------------------------------- EntityNormalizer
  function joinSpelledLetters(text) {
    return text.replace(R('\\b(spelled|spelt|spell it|spell that)\\s+((?:[a-zA-Z]\\s+){1,}[a-zA-Z])\\b', 'gi'), (m0, cue, l) => {
      const letters = ws(l);
      const joined = letters.map(x => x.toLowerCase()).join('');
      const word = letters.length >= 3 ? capFirst(joined) : joined.toUpperCase();
      return `${cue} ${word}`;
    });
  }

  // ------------------------------------------------------------- SelfCorrectionDetector
  const RESTART_MARKERS = ['let me start over', 'let me rephrase', 'scratch all that', 'scratch that',
    'actually no', 'never mind', 'nevermind', 'forget that', 'forget it', 'start over', 'no no no', 'no no'];
  const VAL = '(?:\\d+(?::\\d+)?(?:\\s?[ap]\\.?m\\.?)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
  const VALUE_SWAP = `\\b(${VAL})[\\s,.…]*(?:actually|no,?\\s+make that|make that|or rather|i mean|no)\\s+(${VAL})(?=\\W|$)`;
  const INLINE_MARKERS = [['oops i meant', false], ['on second thought', false], ['wait hold on', false],
    ['no make that', false], ['make that', false], ["let's make it", false], ['or rather', false], ['no wait', false],
    ['i mean', true], ['actually', true], ['sorry', true], ['wait', true]];
  const CLAUSE_STARTERS = new Set(["i", "i'm", "i've", "i'd", "i'll", "it", "it's", "we", "we're", "we've", "we'd", "we'll",
    "you", "you're", "you've", "you'd", "you'll", "he", "he's", "she", "she's", "they", "they're", "there", "here", "let's", "please"]);
  const LEAD_INS = new Set(['oh', 'uh', 'um', 'erm', 'well', 'so', 'sorry', 'hmm', 'hm', 'oops']);
  const P6 = ',.!?;:';

  function detectAndResolve(text) {
    if (!text) return text;
    let t = sub(VALUE_SWAP, (m0, a, b) => b, text, 'i');
    t = resolveStandaloneRestarts(t);
    t = splitIntoSentences(t).map(resolveInline).join(' ');
    return strip(t);
  }
  function isClauseStart(text, index) {
    const prefix = rstrip(text.slice(0, index));
    if (!prefix) return true;
    if (P6.includes(prefix[prefix.length - 1])) return true;
    const lastBreak = Math.max(...[...P6].map(c => prefix.lastIndexOf(c)));
    const tail = strip(prefix.slice(lastBreak + 1));
    if (!tail) return true;
    return tail.split(/\s+/u).every(w => LEAD_INS.has(w.toLowerCase()));
  }
  function resolveStandaloneRestarts(text) {
    let result = text, changed = true;
    while (changed) {
      changed = false;
      let best = -1, bestEnd = -1;
      for (const mk of RESTART_MARKERS) {
        const rx = R('\\b' + esc(mk) + '\\b', 'gi');
        for (const m of result.matchAll(rx)) {
          if (!isClauseStart(result, m.index)) continue;
          const after = lstrip(result.slice(m.index + m[0].length), ' ,.!?;:');
          if (!strip(after)) continue;
          if (m.index >= best) { best = m.index; bestEnd = m.index + m[0].length - 1; }
        }
      }
      if (best >= 0) { result = strip(lstrip(result.slice(bestEnd + 1), ' ,.!?;:')); changed = true; }
    }
    return result;
  }
  const normTok = w => strip(w.toLowerCase(), P6);
  function resolveInline(sentence) {
    const words = ws(sentence);
    if (words.length < 3) return sentence;
    let ms = -1, ml = 0;
    for (const [phrase, gated] of INLINE_MARKERS) {
      const parts = phrase.split(' ');
      let i = 0;
      while (i + parts.length <= words.length) {
        let win = true;
        for (let k = 0; k < parts.length; k++) if (normTok(words[i + k]) !== parts[k]) { win = false; break; }
        if (win && i > 0 && i >= ms) {
          const prev = words[i - 1];
          const last = prev.slice(-1);
          if (gated && !prev.endsWith(',') && !['.', ';', ':'].includes(last)) { i++; continue; }
          ms = i; ml = parts.length;
        }
        i++;
      }
    }
    if (ms <= 0) return sentence;
    const before = words.slice(0, ms), after = words.slice(ms + ml);
    if (!after.length) return before.join(' ');
    const head = normTok(after[0]);
    if (after.length > 6 || CLAUSE_STARTERS.has(head)) return capFirst(after.join(' '));
    const cb = before.slice();
    cb[cb.length - 1] = rstrip(cb[cb.length - 1], P6);
    let ov = -1;
    for (let j = cb.length - 1; j >= 0; j--) if (normTok(cb[j]) === head) { ov = j; break; }
    const kept = ov >= 0 ? cb.slice(0, ov) : cb.slice(0, Math.max(cb.length - 1, 0));
    return kept.concat(after).join(' ');
  }
  const splitIntoSentences = text => text.split(/(?<=[.!?])\s+/u).map(s => strip(s)).filter(s => s);

  // ------------------------------------------------------------- FillerWordRemover
  const DEFAULT_FILLER_WORDS = ['you know', 'basically', 'literally'];
  const GUARDED = { 'you know': new Set(['do', 'did', "didn't", "don't", "doesn't", 'if', 'whether', 'that', 'could', 'would',
    'should', 'can', 'will', 'might', 'may', "won't", "couldn't", "wouldn't", "shouldn't", 'shall']) };
  const HESITATION = '(,\\s*)?\\b(um+|uh+|uhm+|hm+|mm+|mhm+|erm+|er)\\b(\\s*,)?';
  const EDGE_FILLERS = ['you know what i mean', 'i guess', 'kind of', 'sort of', 'or whatever'];

  function removeFillers(text, fillerWords = DEFAULT_FILLER_WORDS) {
    if (!text) return text;
    let result = sub(HESITATION, '', text, 'i');
    for (const f of EDGE_FILLERS) {
      const e = esc(f);
      result = sub(',\\s*' + e + '\\b', '', result, 'i');
      result = sub('\\b' + e + '\\s*,', '', result, 'i');
    }
    const sorted = fillerWords.slice().sort((a, b) => [...b].length - [...a].length);
    for (const filler of sorted) {
      const src = '(,\\s*)?\\b' + esc(filler) + '\\b(\\s*,)?';
      const guard = GUARDED[filler.toLowerCase()];
      result = guard ? removeWithGuards(result, src, guard) : sub(src, '', result, 'i');
    }
    return fillerCleanup(result);
  }
  function removeWithGuards(text, src, guard) {
    const ms = [...text.matchAll(R(src, 'gi'))];
    if (!ms.length) return text;
    let out = '', cursor = 0;
    for (const m of ms) {
      const toks = text.slice(0, m.index).split(/\s+/u).filter(w => w);
      const preceding = toks.length ? strip(toks[toks.length - 1].toLowerCase(), '.,!?;:"\'') : null;
      if (preceding !== null && guard.has(preceding)) continue;
      out += text.slice(cursor, m.index);
      cursor = m.index + m[0].length;
    }
    return out + text.slice(cursor);
  }
  function fillerCleanup(text) {
    let r = sub('\\s{2,}', ' ', text);
    r = sub('\\s+([.,!?;:])', '$1', r);
    r = sub('^\\s*,\\s*', '', r);
    r = sub(',\\s*,', ',', r);
    return strip(r);
  }

  // ------------------------------------------------------------- SpokenFormNormalizer
  const DETERMINER_BEFORE_MARK = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'its', 'his', 'her', 'their',
    'our', 'my', 'your', 'of', 'in', 'during', 'each', 'every', 'another', 'no', 'one', 'semi']);
  const UNAMBIGUOUS = [['question mark', '?'], ['exclamation point', '!'], ['exclamation mark', '!'],
    ['open parenthesis', '('], ['close parenthesis', ')'], ['closed parenthesis', ')'], ['left parenthesis', '('], ['right parenthesis', ')'],
    ['start parenthesis', '('], ['end parenthesis', ')'], ['parenthesis start', '('], ['parenthesis end', ')'],
    ['parenthesis open', '('], ['parenthesis close', ')'], ['parenthesis closed', ')'],
    ['open paren', '('], ['close paren', ')'], ['closed paren', ')'], ['left paren', '('], ['right paren', ')'], ['start paren', '('], ['end paren', ')'],
    ['open bracket', '['], ['close bracket', ']'], ['left bracket', '['], ['right bracket', ']'],
    ['open curly brace', '{'], ['close curly brace', '}'], ['left curly brace', '{'], ['right curly brace', '}'],
    ['open brace', '{'], ['close brace', '}'], ['underscore', '_'], ['ampersand', '&'], ['at sign', '@'],
    ['percent sign', '%'], ['dollar sign', '$'], ['equals sign', '='], ['hash sign', '#'], ['number sign', '#'], ['pound sign', '#'],
    ['plus sign', '+'], ['forward slash', '/'], ['backslash', '\\'], ['back slash', '\\'], ['pipe sign', '|'], ['pipe symbol', '|'],
    ['tilde sign', '~'], ['caret sign', '^']];
  const EMAIL_LOCAL_STOP = new Set(['is', 'at', 'be', 'am', 'are', 'was', 'were', 'the', 'a', 'an', 'to', 'in', 'on', 'of', 'it', 'and', 'or',
    'but', 'so', 'we', 'he', 'she', 'they', 'you', 'i', 'me', 'us', 'this', 'that', 'here', 'there']);
  const DOTTED_EXT = new Set(('js ts jsx tsx py rb rs go swift java kt c cpp h cs php html css scss json xml yaml yml toml md txt pdf doc docx ' +
    'xls xlsx ppt pptx csv log env sh bash zsh fish conf cfg ini lock png jpg jpeg gif svg mp3 mp4 wav mov zip tar gz ' +
    'com org net io dev app ai co edu gov me us uk').split(' '));
  const LABEL_WORDS = new Set(['re', 'subject', 'bug', 'bug report', 'feature', 'feature request', 'todo', 'note', 'warning', 'error', 'info',
    'important', 'from', 'to', 'cc', 'bcc', 'date', 'regarding', 'step', 'example', 'output', 'input', 'result', 'summary',
    'action', 'action item', 'title', 'description']);
  const SENTENCE_START_LABELS = new Set(['re', 'subject', 'bug', 'bug report', 'feature', 'feature request', 'todo', 'note', 'warning',
    'error', 'info', 'important', 'regarding', 'step', 'example', 'summary', 'action', 'action item', 'title', 'description']);

  function spokenNormalize(text, unambiguousOnly = false) {
    if (!text) return text;
    let r = text;
    if (!unambiguousOnly) r = urlsAndPaths(r);
    for (const [s, w] of UNAMBIGUOUS) r = sub('\\b' + esc(s) + '\\b', () => w, r, 'i');
    r = sub('\\bdot\\s+dot\\s+dot\\b', '...', r, 'i');
    r = sub('\\bdash\\s+dash\\s+(\\w+)\\b', '--$1', r, 'i');
    if (!unambiguousOnly) {
      r = labelColons(r);
      r = spokenPunctuation(r);
      r = sub('\\bdash\\s+([a-zA-Z])\\b', '-$1', r, 'i');
    }
    r = sub('\\s+([.,?!);:\\]%])', '$1', r);
    r = sub('([(@\\[#$])\\s+', '$1', r);
    r = sub('\\s*_\\s*', '_', r);
    r = strip(sub('[ \\t]{2,}', ' ', r));
    return r;
  }
  function spokenPunctuation(text) {
    const marks = { 'full stop': '.', 'period': '.', 'comma': ',', 'semicolon': ';', 'colon': ':' };
    return sub('\\b(\\w+)\\s+(full stop|period|comma|semicolon|colon)\\b', (m0, prev, mk) =>
      DETERMINER_BEFORE_MARK.has(prev.toLowerCase()) ? m0 : prev + marks[mk.toLowerCase()], text, 'i');
  }
  const dots = s => sub('\\s+dot\\s+', '.', s, 'i');
  const slashes = s => sub('\\s+slash\\s+', '/', s, 'i');
  function urlsAndPaths(text) {
    let r = text;
    r = sub('\\b(https?|ftp|ssh|git)\\s+colon\\s+slash\\s+slash\\s+(\\S+(?:\\s+dot\\s+\\S+)+(?:\\s+slash\\s+\\S+)*)\\b',
      (m0, a, b) => a + '://' + slashes(dots(b)), r, 'i');
    r = sub('\\b(\\w+(?:\\s+dot\\s+\\w+)+)\\s+slash\\s+(\\w+(?:\\s+slash\\s+\\w+)*)\\b',
      (m0, a, b) => dots(a) + '/' + slashes(b), r, 'i');
    r = sub('\\b((?:\\w+\\s+dot\\s+)*\\w+)\\s+at\\s+(\\w+(?:\\s+dot\\s+\\w+)+)\\b', (m0, local, dom) => {
      const parts = local.split(/\s+/u);
      if (EMAIL_LOCAL_STOP.has(parts[parts.length - 1].toLowerCase())) return m0;
      return dots(local) + '@' + dots(dom);
    }, r, 'i');
    r = sub('\\bslash\\s+(\\w+(?:\\s+dot\\s+\\w+)?(?:\\s+slash\\s+\\w+(?:\\s+dot\\s+\\w+)?)+)\\b',
      (m0, a) => '/' + dots(slashes(a)), r, 'i');
    r = sub('\\b(\\w+)\\s+dot\\s+(\\w+)\\b', (m0, a, b) => DOTTED_EXT.has(b.toLowerCase()) ? `${a}.${b}` : m0, r, 'i');
    return r;
  }
  function labelColons(text) {
    return sub('\\b(\\w+(?:\\s+\\w+)?)\\s+colon(?:\\s+(\\S+))?', (m0, label, nx) => {
      if (!LABEL_WORDS.has(label.toLowerCase())) return m0;
      const cap = capFirst(label);
      const nxt = nx || '';
      if (!nxt) return cap + ':';
      if (SENTENCE_START_LABELS.has(label.toLowerCase())) {
        const skip = nxt.includes('@') || nxt.startsWith('/') || nxt.startsWith('http') || nxt.startsWith('www.') || nxt.startsWith('--');
        const cn = (!skip && isLowerChar(first(nxt))) ? capFirst(nxt) : nxt;
        return `${cap}: ${cn}`;
      }
      return `${cap}: ${nxt}`;
    }, text, 'i');
  }

  // ------------------------------------------------------------- NumberNormalizer
  const NUMERIC_CONTEXT = new Set(('dollars dollar cents cent bucks rupees rupee euros euro pounds pound kg kgs kilograms kilogram grams gram mg lbs ' +
    'miles mile km kilometers meters meter cm mm minutes minute mins min hours hour hrs seconds second secs ' +
    "days day weeks week months month years year am pm o'clock gb mb kb tb px percent degrees degree x " +
    'room page pages chapter step steps version floor level number line lines apartment unit grade rank item items ' +
    'question port figure table section phase part age id').split(' '));
  const PRONOUN_ONE_DET = new Set('the this that other another no any each every which some such only latest last next first best'.split(' '));
  const ONES = new Map(Object.entries({ zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 }));
  const TENS = new Map(Object.entries({ twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }));
  const MULT = new Map(Object.entries({ hundred: 100, thousand: 1000, million: 1000000, billion: 1000000000 }));
  const ORD_ONES = new Map(Object.entries({ first: [1, 'st'], second: [2, 'nd'], third: [3, 'rd'], fourth: [4, 'th'], fifth: [5, 'th'],
    sixth: [6, 'th'], seventh: [7, 'th'], eighth: [8, 'th'], ninth: [9, 'th'], tenth: [10, 'th'], eleventh: [11, 'th'], twelfth: [12, 'th'],
    thirteenth: [13, 'th'], fourteenth: [14, 'th'], fifteenth: [15, 'th'], sixteenth: [16, 'th'], seventeenth: [17, 'th'],
    eighteenth: [18, 'th'], nineteenth: [19, 'th'] }));
  const ORD_TENS = new Map(Object.entries({ twentieth: [20, 'th'], thirtieth: [30, 'th'], fortieth: [40, 'th'], fiftieth: [50, 'th'],
    sixtieth: [60, 'th'], seventieth: [70, 'th'], eightieth: [80, 'th'], ninetieth: [90, 'th'] }));
  const ORD_MULT = new Map(Object.entries({ hundredth: [100, 'th'], thousandth: [1000, 'th'] }));
  // Python ints are unbounded except where _i32 wraps (Kotlin Int); BigInt keeps that exact
  const i32 = v => BigInt.asIntN(32, v);
  const nstrip = s => s === null || s === undefined ? null : strip(s.toLowerCase(), ',.!?;:"\'()');

  function numberNormalize(text) {
    if (!text) return text;
    const words = ws(text);
    if (!words.length) return text;
    const out = [];
    let i = 0;
    while (i < words.length) {
      const [consumed, rep] = tryConsumeNumber(words, i);
      if (consumed > 0 && shouldDigitize(words, i, consumed, rep)) { out.push(rep); i += consumed; }
      else if (consumed > 0) { out.push(...words.slice(i, i + consumed)); i += consumed; }
      else { out.push(words[i]); i++; }
    }
    return out.join(' ');
  }
  function shouldDigitize(words, start, consumed, rep) {
    if (rep.includes('.')) return true;
    if (consumed >= 2) return true;
    const prev = start - 1 >= 0 ? nstrip(words[start - 1]) : null;
    const nxt = start + consumed < words.length ? nstrip(words[start + consumed]) : null;
    const word = nstrip(words[start]) || '';
    if (word === 'one' && (PRONOUN_ONE_DET.has(prev) || nxt === 'of')) return false;
    if (NUMERIC_CONTEXT.has(prev) || NUMERIC_CONTEXT.has(nxt)) return true;
    if (prev === '$' || prev === '#' || nxt === '%') return true;
    const m = rep.match(/^\d*/)[0];
    if (!m) return false;
    const value = BigInt(m);
    if (value > 2147483647n) return false;
    return value >= 10n;
  }
  function tryConsumeNumber(words, start) {
    let i = start, total = 0n, current = 0n, consumed = 0;
    let isOrd = false, ordSuffix = '', hasDec = false, decDigits = [], hasNum = false, lastBareOnes = false;
    const n = words.length;
    while (i < n) {
      const w = words[i].toLowerCase();
      if (w === 'and' && hasNum) { i++; consumed++; continue; }
      if (w === 'a' && !hasNum) {
        if (i + 1 < n && MULT.has(words[i + 1].toLowerCase())) { current = 1n; hasNum = true; i++; consumed++; continue; }
        break;
      }
      if (w === 'point' && hasNum && !hasDec) {
        hasDec = true; i++; consumed++;
        while (i < n) {
          const v = ONES.get(words[i].toLowerCase());
          if (v !== undefined && v <= 9) { decDigits.push(v); i++; consumed++; } else break;
        }
        if (!decDigits.length) { hasDec = false; consumed--; i--; }
        break;
      }
      if (ORD_MULT.has(w)) {
        const [val, suf] = ORD_MULT.get(w);
        if (current === 0n) current = 1n;
        total = i32(total + current * BigInt(val)); current = 0n;
        isOrd = true; ordSuffix = suf; hasNum = true; consumed++; i++;
        break;
      }
      if (ORD_TENS.has(w)) {
        if (lastBareOnes) break;
        const [val, suf] = ORD_TENS.get(w);
        current += BigInt(val); isOrd = true; ordSuffix = suf; hasNum = true; consumed++; i++;
        break;
      }
      if (ORD_ONES.has(w)) {
        const [val, suf] = ORD_ONES.get(w);
        current += BigInt(val); isOrd = true; ordSuffix = suf; hasNum = true; consumed++; i++;
        break;
      }
      if (MULT.has(w)) {
        const mult = BigInt(MULT.get(w));
        if (current === 0n) current = 1n;
        if (mult >= 1000n) { total = i32((total + current) * mult); current = 0n; }
        else current = i32(current * mult);
        hasNum = true; lastBareOnes = false; consumed++; i++; continue;
      }
      if (TENS.has(w)) {
        if (lastBareOnes) break;
        current += BigInt(TENS.get(w)); hasNum = true; lastBareOnes = false; consumed++; i++; continue;
      }
      if (ONES.has(w)) {
        if (lastBareOnes) break;
        current += BigInt(ONES.get(w)); hasNum = true; lastBareOnes = true; consumed++; i++; continue;
      }
      break;
    }
    if (!hasNum) return [0, ''];
    while (consumed > 0 && words[start + consumed - 1].toLowerCase() === 'and') consumed--;
    if (consumed <= 0) return [0, ''];
    total = i32(total + current);
    if (hasDec) return [consumed, `${total}.` + decDigits.join('')];
    if (isOrd) return [consumed, `${total}${ordSuffix}`];
    return [consumed, `${total}`];
  }

  // ------------------------------------------------------------- ListFormatter
  const LF_ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  const LF_CARDINALS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  function listFormat(text) {
    if (!strip(text)) return text;
    const wb = convertNewlineMarks(text);
    if (wb.includes('\n')) return wb;
    return formatNumberedList(wb);
  }
  function convertNewlineMarks(text) {
    let r = sub('\\bnew\\s+paragraph\\b', '\n\n', text, 'i');
    r = sub('\\bnew\\s+lines?\\b|\\bnewline\\b', '\n', r, 'i');
    r = sub('[ \\t]*\\n[ \\t]*', '\n', r);
    return strip(r);
  }
  function formatNumberedList(text) {
    const digit = [...text.matchAll(R('(?:^|(?<=\\s))(\\d+)\\s*[.)]\\s+', 'g'))].map(m => [m.index, m.index + m[0].length, Number(m[1])]);
    let r = buildList(text, digit, 2);
    if (r !== null) return r;
    const bare = [...text.matchAll(R('(?:^|(?<=\\s))(\\d{1,2})\\s+(?=\\S)', 'g'))].map(m => [m.index, m.index + m[0].length, Number(m[1])]);
    r = buildList(text, bare, 3);
    if (r !== null) return r;
    for (const words of [LF_ORDINALS, LF_CARDINALS]) {
      const rx = R('(?:^|(?<=\\s))(' + Object.keys(words).join('|') + ')\\b,?\\s+', 'gi');
      const marks = [...text.matchAll(rx)].filter(m => Object.hasOwn(words, m[1].toLowerCase()))
        .map(m => [m.index, m.index + m[0].length, words[m[1].toLowerCase()]]);
      r = buildList(text, marks, 3);
      if (r !== null) return r;
    }
    return text;
  }
  function buildList(text, markers, minRun) {
    if (markers.length < minRun) return null;
    const start = markers.findIndex(m => m[2] === 1);
    if (start < 0) return null;
    let end = start, expected = 2, j = start + 1;
    while (j < markers.length && markers[j][2] === expected) { end = j; expected++; j++; }
    if (end - start + 1 < minRun) return null;
    const run = markers.slice(start, end + 1);
    let sb = '';
    const lead = strip(text.slice(0, run[0][0]));
    if (lead) sb += lead + '\n';
    for (let k = 0; k < run.length; k++) {
      const m = run[k];
      const itemEnd = k + 1 < run.length ? run[k + 1][0] : text.length;
      const item = rstrip(strip(text.slice(m[1], itemEnd)), ',;');
      if (!item) return null;
      sb += `${m[2]}. ${item}`;
      if (k < run.length - 1) sb += '\n';
    }
    return sb;
  }

  // ------------------------------------------------------------- Capitalizer
  const LEADING_MARKS = new Set(['"', '“', "'", '‘', '(', '[']);
  function capitalizeSentences(text) {
    if (!text) return text;
    const sb = [...text];
    let capNext = true;
    for (let i = 0; i < sb.length; i++) {
      const c = sb[i];
      if (c === '\n') capNext = true;
      else if (isWs(c) || LEADING_MARKS.has(c)) { /* keep */ }
      else if (capNext && isAlpha(c)) { const u = c.toUpperCase(); sb[i] = [...u].length === 1 ? u : c; capNext = false; }
      else capNext = false;
      if ('.!?'.includes(c)) {
        const nxt = i + 1 < sb.length ? sb[i + 1] : ' ';
        if (isWs(nxt)) capNext = true;
      }
    }
    return sb.join('');
  }

  // ------------------------------------------------------------- TextProcessor
  function process(raw, isCode = false) {
    let text = joinSpelledLetters(raw);
    const before = text;
    text = detectAndResolve(text);
    if (!isCode) {
      const bw = ws(before).length, aw = ws(text).length;
      if (bw > 0 && aw > 0 && aw / bw <= 0.5 && isLowerChar(first(text))) text = capFirst(text);
    }
    text = removeFillers(text);
    text = spokenNormalize(text, isCode);
    text = numberNormalize(text);
    text = listFormat(text);
    if (!isCode) text = capitalizeSentences(text);
    return text;
  }

  // ------------------------------------------------------------- demo helper (not in the app)
  // Word-level diff of the raw input against the output, so the page can strike through what
  // was dropped and mark what changed. Purely presentational: process() is the real result.
  function explain(raw) {
    const out = process(raw);
    const a = ws(raw), b = ws(out.replace(/\n/g, ' '));
    const key = w => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
    const n = a.length, m = b.length;
    const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      L[i][j] = key(a[i]) && key(a[i]) === key(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    const tokens = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (key(a[i]) && key(a[i]) === key(b[j])) { tokens.push({ t: a[i], kind: 'keep' }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { tokens.push({ t: a[i], kind: 'drop' }); i++; }
      else { tokens.push({ t: b[j], kind: 'add' }); j++; }
    }
    while (i < n) tokens.push({ t: a[i++], kind: 'drop' });
    while (j < m) tokens.push({ t: b[j++], kind: 'add' });
    return { output: out, tokens };
  }

  const api = { process, explain, joinSpelledLetters, detectAndResolve, removeFillers, spokenNormalize, numberNormalize, listFormat, capitalizeSentences };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KKText = api;
})(typeof self !== 'undefined' ? self : this);
