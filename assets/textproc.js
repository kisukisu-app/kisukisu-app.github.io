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
  const isUpperChar = c => c !== '' && c.toUpperCase() === c && c.toLowerCase() !== c;
  const lastCh = s => s[s.length - 1];
  const mEnd = m => m.index + m[0].length;

  // ------------------------------------------------------------- EntityNormalizer
  function joinSpelledLetters(text) {
    return text.replace(R('\\b(spelled|spelt|spell it|spell that)\\s+((?:[a-zA-Z]\\s+){1,}[a-zA-Z])\\b', 'gi'), (m0, cue, l) => {
      const letters = ws(l);
      const joined = letters.map(x => x.toLowerCase()).join('');
      const word = letters.length >= 3 ? capFirst(joined) : joined.toUpperCase();
      return `${cue} ${word}`;
    }).replace(R("(?<![\\p{L}\\p{N}_'’.])[A-Z](?: [A-Z]){2,}(?![\\p{L}\\p{N}_'’])", 'g'), m => m.replace(/ /g, ''));
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
          // "make that a (numbered) list" is a formatting instruction (TextCommands), not a correction
          if (phrase.endsWith('make that') && R(FORMAT_AFTER_MAKE_THAT, 'i').test(words.slice(i + parts.length, i + parts.length + 5).join(' '))) { i++; continue; }
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
  const FORMAT_AFTER_MAKE_THAT = '^(?:into |in |as )?(?:an? )?(?:numbered |bulleted |bullet )?(?:list|bullet points?|bullets|paragraphs?|e-?mail)\\b';
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

  // ------------------------------------------------------------- TextCommands
  // Instructions said about the dictation ("make this a list", "two paragraphs", "email format",
  // "that's it", "delete the last sentence", ...) are carried out and never typed.
  const TC_STRIP = ',.;:!?"()“”';
  const W_CLS = "[\\p{L}\\p{N}_'’-]";
  const toks = s => ws(strip(s));
  const nw = w => strip(w.toLowerCase().replace(/’/g, "'"), TC_STRIP);
  const endsSentence = w => { const t = rstrip(w, '"”)'); return t !== '' && '.!?'.includes(lastCh(t)); };
  const all = (a, f) => a.every(f);
  const ORD = { first: 1, firstly: 1, second: 2, secondly: 2, third: 3, thirdly: 3, fourth: 4, fourthly: 4, fifth: 5, fifthly: 5,
    sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };
  const CARD = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10 };
  const COUNT = { a: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
  const look = (map, k) => (k !== null && k !== undefined && Object.hasOwn(map, k)) ? map[k] : null;
  const SMALL_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const set = s => new Set(s.split(' '));
  const LEAD = set("okay ok so see maybe now right alright well let's lets let us just please can could would will you i want wanna to we i'd " +
    "i'll we'll like yeah yes and then also hey oh um uh hmm first things try going gonna i'm we're need kindly actually go ahead do me should shall");
  const TAIL = set('ok okay right please now like alright then so yeah');
  const CONTENT_LEAD = set('okay ok so alright um uh well right now like yeah');
  const BLOCK = set("to you can could will would should please must might may shall i'll we'll gonna wanna and or not never don't didn't won't " +
    "let's lets me us i we they he she just also");
  const CLAUSE_START = set("the i we it it's its they he she you my our a an this there so and let's then actually instead no");
  const STOP = set('the a an to of is are was were for in on at with my your our i we you it this that be have has need want ' +
    'please from by me us all some do can will not but or so');
  const FILLER = set('thing things item one step stop point paragraph part');
  const STRONG_FILLER = set('thing things item step stop point');

  function textCommands(text) {
    if (!strip(text) || text.includes('\n')) return text;
    const t = quotesAndBrackets(strip(text));
    const edited = withEdits(t);
    if (edited !== null) return edited;
    const b = tcBuild(resolveDeleteThat(t), []);
    return b !== null ? b : resolveDeleteThat(t);
  }
  function quotesAndBrackets(t) {
    let r = t.replace(R('\\b(?:open\\s+)?quote,?\\s+(.+?),?\\s+(?:end|close)\\s+quote\\b|\\bquote,?\\s+(.+?),?\\s+unquote\\b', 'gi'),
      (m0, a, b) => '"' + strip(a !== undefined ? a : b) + '"');
    return r.replace(R('\\b(?:in|open)\\s+brackets,?\\s+(.+?),?\\s+(?:close|end)\\s+brackets?\\b', 'gi'), (m0, a) => '(' + strip(a) + ')');
  }
  function withEdits(t) {
    const [body, edits] = splitTrailingEdits(t);
    if (!edits.length) return null;
    let cur = resolveDeleteThat(body);
    const itemEdits = [];
    for (const e of edits) {
      if (ITEM_KINDS.has(e[0])) { itemEdits.push(e); continue; }
      cur = applyProseEdit(cur, e);
      if (cur === null) return null;
    }
    if (!itemEdits.length) { const b = tcBuild(cur, []); return b !== null ? b : cur; }
    return tcBuild(cur, itemEdits);
  }

  // edits: [kind, a, b, all, c]
  const CMD_END = '[\\s,]*(?:please)?[\\s.!?]*$';
  const DEL = '(?:delete|remove|scratch|cross out|cut|drop|take out)';
  const ITEM_KINDS = new Set(['ITEM_N', 'ITEM_END', 'LAST_N', 'SWAP', 'MOVE', 'ADD', 'SET_ITEM']);
  const Wp = W_CLS + '+';
  const EDIT_RULES = [
    ['LAST_SENTENCE', `${DEL} (?:the )?last sentence`],
    ['ITEM_N', `${DEL} (?:item|number|line|point) (${Wp})`],
    ['LAST_N', `${DEL} the (last|first) (two|three|2|3)(?: items| ones| things| lines)?`],
    ['ITEM_END', `${DEL} the (last|first|final) (?:item|one|line|thing|point)`],
    ['ITEM_N', `${DEL} the (${Wp}) (?:item|one|line|point|thing)`],
    ['SWAP', 'swap the first two(?: items| ones| things)?'],
    ['MOVE', `move (${Wp}(?: ${Wp}){0,3}) to the (end|bottom|top|start|beginning|front)`],
    ['ADD', `add (${Wp}(?: ${Wp}){0,3}) to the list`],
    ['SET_ITEM', `(?:actually,? )?(?:make|change) the (${Wp}) (?:item|one|thing)(?: to| into)? (${Wp}(?: ${Wp}){0,3})`],
    ['SET_ITEM', `(?:actually,? )?(?:make|change) (?:item|number) (${Wp})(?: to| into)? (${Wp}(?: ${Wp}){0,3})`],
    ['REPLACE', `(?:change|replace) (${Wp}(?: ${Wp})?) (?:to|with) (${Wp}(?: ${Wp}){0,2}?)( everywhere| throughout)?`],
    ['ADD_WORD', `add the word (${Wp}) (after|before) (${Wp})`],
    ['QUOTE', `put (${Wp}(?: ${Wp}){0,5}?) in (?:quotes|quotation marks)`],
    ['DELETE_WORD', `${DEL} (?:the word )?(${Wp}(?: ${Wp})?)`],
  ].map(([k, p]) => [k, '(?:^|(?<=[\\s.,!?;]))' + p + CMD_END]);
  const NOT_A_WORD_TARGET = set('that this it them everything all the a an last first item items one sentence word line these those');
  const gv = (m, n) => m[n] === undefined ? '' : m[n];

  function splitTrailingEdits(t) {
    let body = t;
    const edits = [];
    for (let r = 0; r < 3; r++) {
      let found = null;
      for (const [kind, src] of EDIT_RULES) {
        const m = R(src, 'i').exec(body);
        if (!m) continue;
        const pre = rstrip(body.slice(0, m.index));
        const preToks = toks(pre);
        if (preToks.length < 2) continue;
        if (!'.!?,;:'.includes(lastCh(pre)) && BLOCK.has(nw(preToks[preToks.length - 1]))) continue;
        const g1 = gv(m, 1), g2 = gv(m, 2), g3 = gv(m, 3);
        if (kind === 'DELETE_WORD' && toks(g1).some(x => NOT_A_WORD_TARGET.has(nw(x)))) continue;
        if (kind === 'REPLACE' && all(toks(g1), x => NOT_A_WORD_TARGET.has(nw(x)))) continue;
        found = [[kind, g1, g2, strip(g3) !== '' && kind === 'REPLACE', g3], m.index];
        break;
      }
      if (!found) return [body, edits.reverse()];
      edits.push(found[0]);
      body = rstrip(body.slice(0, found[1]));
    }
    return [body, edits.reverse()];
  }
  // u-mode escaping (a "\\-" outside a class is a syntax error under the u flag)
  const escU = x => x.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const wordRx = (x, flags) => R("(?<![\\p{L}\\p{N}_'’])" + toks(x).map(w => escU(strip(w, TC_STRIP))).join('\\s+') + "(?![\\p{L}\\p{N}_'’])", flags);
  function applyProseEdit(t, e) {
    const [kind, a, b, isAll, c] = e;
    if (kind === 'LAST_SENTENCE') {
      const s = tcSentences(t);
      if (s.length < 2) return null;
      return s.slice(0, -1).join(' ');
    }
    if (kind === 'REPLACE') {
      const hits = [...t.matchAll(wordRx(a, 'gi'))];
      if (!hits.length || (!isAll && hits.length !== 1)) return null;
      const y = strip(b, TC_STRIP);
      return t.replace(wordRx(a, 'gi'), m0 => isUpperChar(first(m0)) ? capFirst(y) : y);
    }
    if (kind === 'DELETE_WORD') {
      const hits = [...t.matchAll(wordRx(a, 'gi'))];
      if (hits.length !== 1) return null;
      const h = hits[0];
      const r = strip(rstrip(t.slice(0, h.index)) + ' ' + lstrip(t.slice(mEnd(h))));
      return sub(' ([,.!?;:])', '$1', r);
    }
    if (kind === 'ADD_WORD') {
      const hits = [...t.matchAll(wordRx(c, 'gi'))];
      if (hits.length !== 1) return null;
      const h = hits[0];
      const x = strip(a, TC_STRIP);
      if (nw(b) === 'after') return t.slice(0, mEnd(h)) + ' ' + x + t.slice(mEnd(h));
      return t.slice(0, h.index) + x + ' ' + t.slice(h.index);
    }
    if (kind === 'QUOTE') {
      const hits = [...t.matchAll(wordRx(a, 'gi'))];
      if (!hits.length) return null;
      const h = hits[hits.length - 1];
      return t.slice(0, h.index) + '"' + h[0] + '"' + t.slice(mEnd(h));
    }
    return null;
  }
  function itemIndex(a, items) {
    const w = nw(a);
    if (w === 'last' || w === 'final') return items.length;
    const c = look(CARD, w);
    return c !== null ? c : look(ORD, w);
  }
  function applyItemEdit(items, e) {
    const [kind, a, b] = e;
    if (kind === 'ITEM_N') {
      const n = itemIndex(a, items);
      if (n === null || n < 1 || n > items.length) return false;
      items.splice(n - 1, 1);
    } else if (kind === 'ITEM_END') {
      if (nw(a) === 'first') items.shift(); else items.pop();
    } else if (kind === 'LAST_N') {
      const n = look(CARD, nw(b));
      if (n === null || n >= items.length) return false;
      for (let k = 0; k < n; k++) { if (nw(a) === 'first') items.shift(); else items.pop(); }
    } else if (kind === 'SWAP') {
      if (items.length < 2) return false;
      [items[0], items[1]] = [items[1], items[0]];
    } else if (kind === 'MOVE') {
      let x = nw(a);
      if (x.startsWith('the ')) x = x.slice(4);
      let idx;
      if (['last one', 'last item', 'last'].includes(x)) idx = items.length - 1;
      else if (['first one', 'first item', 'first'].includes(x)) idx = 0;
      else {
        idx = items.findIndex(it => nw(it) === x);
        if (idx < 0) idx = items.findIndex(it => nw(it).includes(x));
      }
      if (idx < 0) return false;
      const [it] = items.splice(idx, 1);
      if (['end', 'bottom'].includes(nw(b))) items.push(it); else items.unshift(it);
    } else if (kind === 'ADD') {
      items.push(cleanItem(a));
    } else if (kind === 'SET_ITEM') {
      const n = itemIndex(a, items);
      if (n === null || n < 1 || n > items.length) return false;
      items[n - 1] = cleanItem(b);
    } else return false;
    return items.length >= 1;
  }

  const SENT_BREAK = '[.!?]["”\')]*\\s+';
  function resolveDeleteThat(t0) {
    let t = t0;
    for (let r = 0; r < 3; r++) {
      let changed = false;
      for (const m of t.matchAll(R('\\b(?:delete|undo) that\\b', 'gi'))) {
        const pre = rstrip(t.slice(0, m.index));
        if (!pre) continue;
        const afterTrim = lstrip(t.slice(mEnd(m)));
        const at = toks(afterTrim);
        const nextTok = at.length ? nw(at[0]) : '';
        const okNext = !afterTrim || '.,!?;:'.includes(afterTrim[0]) || CLAUSE_START.has(nextTok);
        const pt = toks(pre);
        const okPrev = '.!?,;:'.includes(lastCh(pre)) || !BLOCK.has(nw(pt[pt.length - 1]));
        if (!okNext || !okPrev) continue;
        const core = rstrip(pre, ',;: ');
        const body = core && '.!?'.includes(lastCh(core)) ? core.slice(0, -1) : core;
        const brs = [...body.matchAll(R(SENT_BREAK, 'g'))];
        const kept = brs.length ? strip(body.slice(0, mEnd(brs[brs.length - 1]))) : '';
        const rest = lstrip(afterTrim, '.,!?;: ');
        if (!kept) t = capFirst(rest);
        else if (!rest) t = kept;
        else t = `${kept} ${capFirst(rest)}`;
        t = strip(t);
        changed = true;
        break;
      }
      if (!changed) return t;
    }
    return t;
  }

  // instructions: [kind, regex source, makeAList]
  const OBJ = '(?:this|these|that|it|them|everything|the following|all (?:of )?(?:this|that|these|it))';
  const LISTWORD = '(?:list|bullet ?points?|bullets)';
  const LISTADJ = '(?:numbered |bulleted |bullet(?:ed)? (?:point )?|dotted )?';
  const N_PARA = '(?:a |one |single |two |three |four |five |six |[1-6] )?(?:single )?paragraphs?';
  const spaced = p => p.split(' ?').join('\\s*').split(' ').join('\\s+').split("'").join("['’]");
  const RULES = [
    ['LIST', `\\b(?:make|turn|put|convert|format|change|do|write|set) ${OBJ}(?: (?:in|into|as|to))?(?: an?)? ${LISTADJ}${LISTWORD}(?: format)?\\b`, false],
    ['LIST', `\\bmake (?:me )?an? ${LISTADJ}(?:list)\\b(?: (?:like|of the following|of these|with the following))?`, true],
    ['LIST', `\\b(?:as|in|into) (?:a |the )?${LISTADJ}${LISTWORD}(?: format)?\\b`, false],
    ['LIST', '\\b(?:in )?(?:a )?list format\\b', false],
    ['LIST', '\\b(?:number|list|bullet ?point|bullet) (?:these|them|this|that|the following|it)\\b', false],
    ['LIST', '\\b(?:bullet ?points?|bulleted list|numbered list|bullets)\\b', false],
    ['PARA', `\\b(?:make|turn|put|split|break|format|divide|write|do|change) ${OBJ}(?: up)? (?:in|into|as|to) ${N_PARA}\\b`, false],
    ['PARA', "\\b(?:i want|i'd like|i would like|give me|let's do|let's have|let's make it|we need|make it|in|as|with) (?:a|one|two|three|four|five|six|[1-6]) (?:single )?paragraphs?\\b", false],
    ['PARA', '\\b(?:two|three|four|five|six|[2-6]) paragraphs\\b', false],
    ['EMAIL', `\\b(?:make|turn|put|format|write|convert|do|change) ${OBJ} (?:in|into|as|to) (?:an? )?e-?mail(?: format)?\\b`, false],
    ['EMAIL', '\\b(?:in |as )?(?:an? )?e-?mail format\\b', false],
  ].map(([k, p, mal]) => [k, spaced(p), mal]);
  const MAKE_A_LIST_NEXT_BLOCK = set('of for to about that which with and so before after at on in from');
  const EVENLY = '\\b(?:and\\s+)?(?:split|divide|break)(?:\\s+(?:them|it|this|these|that))?(?:\\s+up)?\\s+evenly\\b[.,!]?';
  const PARA_COUNT = '\\b(a|one|single|two|three|four|five|six|[1-6])\\s+(?:single\\s+)?paragraphs?\\b';

  // built: ['items', lead, items, bullet] or ['text', text]
  function tcBuild(t, itemEdits) {
    let b = findInstruction(t);
    if (b === null) b = findImplied(t, itemEdits.length > 0);
    if (b === null) return null;
    if (b[0] === 'text') return itemEdits.length ? null : b[1];
    const [, lead, items, bullet] = b;
    for (const e of itemEdits) if (!applyItemEdit(items, e)) return null;
    return renderList(lead, items, bullet);
  }
  function findInstruction(t) {
    const hits = [];
    for (const rule of RULES) for (const m of t.matchAll(R(rule[1], 'gi'))) hits.push([rule, m.index, mEnd(m), m[0]]);
    hits.sort((x, y) => x[1] - y[1] || y[2] - x[2]);
    for (const h of hits) { const r = tryInstruction(t, h); if (r !== null) return r; }
    return null;
  }
  function tryInstruction(t, h) {
    const [[kind, , makeAList], hstart, hend, htext] = h;
    if (makeAList) {
      const lw = htext.toLowerCase();
      if (!lw.endsWith('like') && !lw.endsWith('following') && !lw.endsWith('these')) {
        const nt = toks(t.slice(hend));
        const st = lstrip(t.slice(hend));
        if (nt.length && !(st && ',:.!?'.includes(st[0])) && MAKE_A_LIST_NEXT_BLOCK.has(nw(nt[0]))) return null;
      }
    }
    if (kind === 'LIST' && R('points?$', 'i').test(htext)) {
      const nt = toks(t.slice(hend));
      if (nt.length && look(CARD, nw(nt[0])) !== null) return null;
    }
    const brs = [...t.slice(0, hstart).matchAll(R(SENT_BREAK, 'g'))];
    const sentStart = brs.length ? mEnd(brs[brs.length - 1]) : 0;
    const prefix = t.slice(sentStart, hstart);
    const prefixToks = toks(prefix.replace(R('first things first', 'gi'), ' '));
    const leadOnly = all(prefixToks, x => !nw(x) || LEAD.has(nw(x)));
    const restIdx = skipTail(t, hend);
    const after = strip(t.slice(restIdx));
    const before = strip(t.slice(0, sentStart));
    let content, lead;
    if (leadOnly) {
      if (after) { content = after; lead = before; } else { content = before; lead = ''; }
    } else {
      if (after) return null;
      if (!prefixToks.length) return null;
      const last = prefixToks[prefixToks.length - 1];
      if (!'.!?,;:'.includes(lastCh(rstrip(prefix))) && BLOCK.has(nw(last))) return null;
      content = rstrip(strip(t.slice(0, hstart)), ',;:');
      lead = '';
    }
    const evenly = kind === 'PARA' && (R(EVENLY, 'i').test(content) || R(EVENLY, 'i').test(lead));
    if (kind === 'PARA') {
      content = tidy(content.replace(R(EVENLY, 'gi'), ' '));
      lead = tidy(lead.replace(R(EVENLY, 'gi'), ' '));
    }
    content = dropLeadWords(content, CONTENT_LEAD);
    if (!strip(content)) return null;
    if (kind === 'LIST') {
      const bullet = R('bullet|dotted', 'i').test(htext);
      const sp = splitItems(content, true);
      if (sp === null) return null;
      const pre = sp[0];
      const prePart = all(toks(pre), x => LEAD.has(nw(x))) ? '' : pre;
      const fullLead = [lead, prePart].filter(x => strip(x)).join(' ');
      return ['items', fullLead, sp[1], bullet || sp[2]];
    }
    if (kind === 'PARA') {
      const pm = R(PARA_COUNT, 'i').exec(htext);
      const n = (pm ? look(COUNT, pm[1].toLowerCase()) : null) || 0;
      const paras = splitParas(content, n, evenly);
      if (paras === null) return null;
      return ['text', [lead].filter(x => strip(x)).concat(paras).join('\n\n')];
    }
    const mail = renderEmail(content);
    if (mail === null) return null;
    return ['text', !strip(lead) ? mail : `${lead}\n\n${mail}`];
  }
  function skipTail(t, from) {
    let i = from;
    const n = t.length;
    for (;;) {
      while (i < n && (isWs(t[i]) || ',:;-'.includes(t[i]))) i++;
      if (i >= n) return i;
      if ('.!?'.includes(t[i])) { while (i < n && '.!?'.includes(t[i])) i++; return i; }
      let j = i;
      while (j < n && !isWs(t[j])) j++;
      const w = t.slice(i, j);
      if (!TAIL.has(nw(w))) return i;
      i = j;
      if (endsSentence(w)) return i;
    }
  }
  function dropLeadWords(s, words) {
    const tk = toks(s);
    let i = 0;
    while (i < tk.length - 1 && words.has(nw(tk[i]))) i++;
    return lstrip(tk.slice(i).join(' '), ',:; ');
  }
  function tidy(s) {
    s = sub('[ \\t]{2,}', ' ', s);
    s = sub(' ([,.!?;:])', '$1', s);
    s = sub('^[\\s,.;:]+', '', s);
    return strip(s);
  }

  // implied lists; markers are [start, end (after fillers), strong 0|1]
  function findImplied(t, relaxed) {
    const [body, hadEnd] = stripEndMarker(t);
    const tk = toks(body);
    const ordm = ordinalMarkers(tk, false);
    if (ordm !== null) {
      const strong = ordm.some(m => m[2] === 1);
      if (ordm.length >= 3 || (ordm.length >= 2 && (strong || hadEnd || relaxed))) {
        const r = itemsFrom(tk, ordm, 15);
        if (r !== null) return ['items', r[0], r[1], false];
      }
    }
    const sc = strongCardinalMarkers(tk);
    if (sc !== null) { const r = itemsFrom(tk, sc[0], 15); if (r !== null) return ['items', r[0], r[1], sc[1]]; }
    const dm = dashMarkers(tk, 3);
    if (dm !== null) { const r = itemsFrom(tk, dm, 15); if (r !== null) return ['items', r[0], r[1], true]; }
    const pm = plainCardinalMarkers(tk);
    if (pm !== null) {
      const commaMarked = all(pm, m => tk[m[0]].endsWith(',') && (m[0] === 0 || endsSentence(tk[m[0] - 1])));
      const onlyCounting = tk.filter(x => look(CARD, nw(x)) !== null).length === pm.length;
      if (commaMarked || (onlyCounting && (pm.length >= 3 || relaxed))) {
        const r = itemsFrom(tk, pm, 15);
        if (r !== null) return ['items', r[0], r[1], false];
      }
    }
    return null;
  }
  const ORD_PREV_BLOCK = set('the my our a his her their your this came is was');
  function ordinalMarkers(tk, allowSeq) {
    const res = [];
    let last = 0, i = 0;
    const n = tk.length;
    while (i < n) {
      const w = nw(tk[i]);
      const nx = i + 1 < n ? nw(tk[i + 1]) : null;
      const prev = i - 1 >= 0 ? nw(tk[i - 1]) : null;
      let v = look(ORD, w), len = 1;
      if (v !== null) {
        if (w === 'first' && ['of', 'things', 'time', 'place'].includes(nx)) v = null;
        else if (ORD_PREV_BLOCK.has(prev) && !endsSentence(tk[i - 1]) && !tk[i - 1].endsWith(',') && !STRONG_FILLER.has(nx)) v = null;
      } else if (res.length && (w === 'lastly' || w === 'finally' ||
          (allowSeq && (w === 'then' || w === 'next' || (w === 'after' && nx === 'that'))))) {
        v = last + 1;
        if (w === 'after') len = 2;
      } else if (res.length && w === 'oh' && nx === 'and' && i + 2 < n && nw(tk[i + 2]) === 'also') {
        v = last + 1; len = 3;
      }
      if (v !== null && ((!res.length && v === 1) || (res.length && v > last))) {
        let j = i + len, strong = 0;
        if (j < n && FILLER.has(nw(tk[j])) && !endsSentence(tk[j - 1])) {
          if (STRONG_FILLER.has(nw(tk[j]))) strong = 1;
          j++;
          if (j < n && ['is', 'was'].includes(nw(tk[j])) && !endsSentence(tk[j - 1])) j++;
        }
        res.push([i, j, strong]);
        last = v; i = j;
        continue;
      }
      i++;
    }
    return res.length >= 2 ? res : null;
  }
  function strongCardinalMarkers(tk) {
    const res = [];
    let bullet = false, i = 0;
    while (i < tk.length - 1) {
      const w = nw(tk[i]);
      let lead = 0;
      if (['number', 'step', 'item', 'point'].includes(w) && !endsSentence(tk[i])) lead = 1;
      else if (w === 'bullet' && i + 2 < tk.length && nw(tk[i + 1]) === 'point') lead = 2;
      else if (w === 'bullet') lead = 1;
      if (lead > 0 && i + lead < tk.length && look(CARD, nw(tk[i + lead])) === res.length + 1) {
        if (w === 'bullet') bullet = true;
        res.push([i, i + lead + 1, 1]);
        i += lead + 1;
        continue;
      }
      i++;
    }
    return res.length >= 2 ? [res, bullet] : null;
  }
  function dashMarkers(tk, min) {
    const res = [];
    tk.forEach((x, k) => { if (nw(x) === 'dash') res.push([k, k + 1, 0]); });
    return res.length >= min ? res : null;
  }
  function plainCardinalMarkers(tk) {
    const res = [];
    tk.forEach((x, k) => { if (look(CARD, nw(x)) === res.length + 1) res.push([k, k + 1, 0]); });
    return res.length >= 2 ? res : null;
  }
  function itemsFrom(tk, marks, maxLen) {
    const pre = tk.slice(0, marks[0][0]).join(' ');
    const items = [];
    for (let k = 0; k < marks.length; k++) {
      const m = marks[k];
      const end = k + 1 < marks.length ? marks[k + 1][0] : tk.length;
      if (m[1] > end) return null;
      const raw = tk.slice(m[1], end);
      if (raw.length > maxLen) return null;
      const fixed = correctItem(raw.join(' '));
      if (fixed === null) continue;
      const item = cleanItem(fixed);
      if (!item) return null;
      items.push(item);
    }
    if (!items.length) return null;
    return [pre, items];
  }

  const ITEM_FIX = '^(.+?),?\\s+(?:no,? (?:wait|weight)|(?:wait|weight),? no|sorry|i mean|actually,? make that|make that|actually|no)\\b,?\\s+(.+)$';
  const SKIP = '^(?:skip|scratch|drop|remove|forget|cross out),?\\s+(?:the\\s+)?(.+)$';
  const ITEM_ASIDE = '^(?:oh,?\\s+)?(?:i (?:almost )?forgot|and also|also)\\b,?\\s+';
  const ITEM_FIX_VERBS = set('make change move add delete remove swap put replace');
  function correctItem(s) {
    const t = strip(s).replace(R(ITEM_ASIDE, 'i'), '');
    const m = R(ITEM_FIX, 'i').exec(t);
    if (!m) return t;
    const firstPart = m[1];
    const second = strip(m[2]);
    // the match spans all of t: group 1 starts at 0, group 2 runs to the end
    const marker = strip(t.slice(m[1].length, t.length - m[2].length), ' ,').toLowerCase();
    const skip = R(SKIP, 'i').exec(second);
    if (skip) {
      const what = toks(skip[1]).map(nw).filter(x => !STOP.has(x));
      const ft = toks(firstPart).map(nw);
      return what.length && all(what, w => ft.includes(w)) ? null : t;
    }
    if (marker === 'no') return t;
    const st = toks(second);
    if (st.length > 6) return t;
    if (ITEM_FIX_VERBS.has(nw(st[0]))) return t;
    return second;
  }
  const END_MARKER = "(?:^|[,.;!?]\\s*|\\s+)(?:and\\s+)?(?:that['’]s\\s+it|that['’]s\\s+all|that['’]s\\s+the\\s+list|that['’]s\\s+everything|" +
    'that\\s+is\\s+it|that\\s+is\\s+all|end\\s+of\\s+(?:the\\s+)?list|done)[.!]?\\s*$';
  function stripEndMarker(s) {
    const m = R(END_MARKER, 'i').exec(s);
    if (!m) return [s, false];
    const body = strip(s.slice(0, m.index));
    return body ? [body, true] : [s, false];
  }
  const DETERMINERS = set('the a an my our your');
  const TODO_VERBS = set('call pay book buy get email text send fix clean wash walk water pick check finish write ring renew cancel ' +
    'order return collect feed mow paint tidy post print update ship review prepare bring take make');
  function splitItems(content0, instructed) {
    const content = stripEndMarker(content0)[0].replace(R(',?\\s*\\boh,?\\s+and\\s+also\\b,?', 'gi'), ',');
    const tk = toks(content);
    let m = ordinalMarkers(tk, instructed);
    if (m !== null) { const r = itemsFrom(tk, m, 40); if (r !== null) return [r[0], r[1], false]; }
    const sc = strongCardinalMarkers(tk);
    if (sc !== null) { const r = itemsFrom(tk, sc[0], 40); if (r !== null) return [r[0], r[1], sc[1]]; }
    m = dashMarkers(tk, 2);
    if (m !== null) { const r = itemsFrom(tk, m, 40); if (r !== null) return [r[0], r[1], true]; }
    m = plainCardinalMarkers(tk);
    if (m !== null) { const r = itemsFrom(tk, m, 40); if (r !== null) return [r[0], r[1], false]; }
    const parts = content.split(R('(?<=[,;.!?])\\s+', '')).map(x => strip(x)).filter(x => x);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1];
      const ands = [...last.matchAll(R('\\s+and\\s+', 'gi'))];
      if (ands.length && toks(last).length <= 8) {
        const a = ands[ands.length - 1];
        parts.pop();
        parts.push(last.slice(0, a.index));
        parts.push(last.slice(mEnd(a)));
      }
      const items = parts.map(cleanItem).filter(x => x);
      return items.length >= 2 ? ['', items, false] : null;
    }
    const words = tk.filter(x => nw(x) !== 'and');
    if (words.length >= 2 && words.length <= 10 && !words.some(x => STOP.has(nw(x)))) return ['', words.map(cleanItem), false];
    for (const starts of [DETERMINERS, TODO_VERBS]) {
      if (!starts.has(nw(tk[0]))) continue;
      const chunks = [];
      for (const w of tk) {
        if (starts.has(nw(w)) && (!chunks.length || chunks[chunks.length - 1].length >= 2 || starts === DETERMINERS)) chunks.push([]);
        chunks[chunks.length - 1].push(w);
      }
      if (chunks.length >= 2 && all(chunks, c => c.length >= 1 && c.length <= 6)) return ['', chunks.map(c => cleanItem(c.join(' '))), false];
    }
    return null;
  }
  const ITEM_LEAD = set('and then also plus so okay ok oh');
  function cleanItem(s0) {
    let tk = toks(lstrip(strip(s0), ',:;- '));
    while (tk.length > 1 && ITEM_LEAD.has(nw(tk[0]))) tk = tk.slice(1);
    while (tk.length > 1 && ['and', 'then', 'the'].includes(nw(tk[tk.length - 1])) && !endsSentence(tk[tk.length - 2])) tk = tk.slice(0, -1);
    let s = lstrip(rstrip(strip(tk.join(' ')), ',;:. '), ',:;- ');
    const m = s.match(/^([1-9])\s+(?=[A-Za-z])/u);
    if (m) s = SMALL_WORD[Number(m[1])] + s.slice(m[0].length - 1);
    return capFirst(s);
  }
  const LIST_IS = set("the list is here's here my this");
  function tcLeadLine(s0) {
    const s = rstrip(strip(s0), ',; ');
    if (!s) return null;
    if (all(toks(s), x => LEAD.has(nw(x)) || LIST_IS.has(nw(x)))) return null;
    const last = lastCh(s);
    if (last === ':') return s;
    if (last === '.' && toks(s).length <= 4) return s.slice(0, -1) + ':';
    if ('.!?'.includes(last)) return s;
    return s + ':';
  }
  function renderList(lead, items, bullet) {
    const lines = [];
    const ll = tcLeadLine(lead);
    if (ll !== null) lines.push(capFirst(ll));
    items.forEach((it, k) => lines.push(bullet ? `- ${it}` : `${k + 1}. ${it}`));
    return lines.join('\n');
  }

  // paragraphs
  const tcSentences = s => s.split(/(?<=[.!?])\s+/u).map(x => strip(x)).filter(x => x);
  const wc = s => toks(s).length;
  const ensureEnd = s => !s || '.!?'.includes(lastCh(s)) ? s : s + '.';
  function cleanSeg(s) {
    let tk = toks(lstrip(strip(s), ',:;- '));
    while (tk.length > 1 && ITEM_LEAD.has(nw(tk[0]))) tk = tk.slice(1);
    return capFirst(rstrip(tk.join(' '), ',;: '));
  }
  function splitParas(content0, n, evenly) {
    const content = stripEndMarker(content0)[0];
    const tk = toks(content);
    let segs = null;
    if (!evenly) {
      let marks = ordinalMarkers(tk, false);
      if (marks === null) { const sc = strongCardinalMarkers(tk); marks = sc !== null ? sc[0] : null; }
      if (marks === null) marks = plainCardinalMarkers(tk);
      if (marks !== null) {
        const pre = tk.slice(0, marks[0][0]).join(' ');
        let parts = [];
        if (strip(pre) && !all(toks(pre), x => LEAD.has(nw(x)))) parts.push(pre);
        for (let k = 0; k < marks.length; k++) {
          const m = marks[k];
          const end = k + 1 < marks.length ? marks[k + 1][0] : tk.length;
          if (m[1] >= end) { parts = []; break; }
          parts.push(tk.slice(m[1], end).join(' '));
        }
        if (parts.length >= 2) segs = parts;
      }
    }
    const segList = (segs !== null ? segs : tcSentences(content)).map(cleanSeg).filter(x => x);
    if (!segList.length) return null;
    if (n === 1) return [segList.map(ensureEnd).join(' ')];
    if (n === 0 || segList.length === n) return segList.length >= 2 ? segList : null;
    if (segList.length < n) {
      while (segList.length < n) {
        let idx = 0;
        for (let k = 0; k < segList.length; k++) if (wc(segList[k]) > wc(segList[idx])) idx = k;
        const w = toks(segList[idx]);
        if (w.length < 2) return null;
        const half = Math.floor(w.length / 2);
        segList.splice(idx, 1, rstrip(w.slice(0, half).join(' '), ','), capFirst(w.slice(half).join(' ')));
      }
      return segList;
    }
    const total = segList.reduce((acc, x) => acc + wc(x), 0);
    const groups = [];
    let cum = 0, p = 0;
    segList.forEach((s, idx) => {
      if (groups.length <= p) groups.push([]);
      groups[p].push(s);
      cum += wc(s);
      const remainingS = segList.length - idx - 1, remainingP = n - p - 1;
      if (remainingP > 0 && (cum * n >= total * (p + 1) || remainingS === remainingP)) p++;
    });
    return groups.map(gr => gr.join(' '));
  }

  // email
  const GREET = set('dear hi hello hey hiya');
  const TITLES = set('mr mrs ms miss dr sir madam professor prof');
  const SIGN_PHRASES = ['kind regards', 'best regards', 'warm regards', 'warmest regards', 'many thanks', 'thanks again',
    'thank you', 'best wishes', 'all the best', 'yours sincerely', 'yours faithfully', 'yours truly',
    'take care', 'regards', 'thanks', 'cheers', 'love', 'best', 'sincerely', 'warmly'].map(p => p.split(' '));
  const SIGN_WORDS = new Set(SIGN_PHRASES.flat());
  function renderEmail(content) {
    const tk = toks(content);
    const n = tk.length;
    if (n < 2) return null;
    let gEnd = 0;
    const g0 = nw(tk[0]);
    const gStart = GREET.has(g0) ? 1 : (g0 === 'good' && ['morning', 'afternoon', 'evening'].includes(nw(tk[1])) ? 2 : 0);
    if (gStart > 0) {
      if (tk[gStart - 1].endsWith(',')) gEnd = gStart;
      else {
        for (let k = gStart; k < Math.min(n, gStart + 4); k++) if (tk[k].endsWith(',')) { gEnd = k + 1; break; }
        if (gEnd === 0) {
          let k = gStart;
          if (k < n && TITLES.has(nw(tk[k]))) k++;
          if (k < n) k++;
          gEnd = k;
        }
      }
    }
    const anyPunct = /[.,!?]/.test(content);
    let sStart = -1, signoff = '', name = '';
    for (let nameLen = 1; nameLen <= 3; nameLen++) {
      const nameStart = n - nameLen;
      if (nameStart <= gEnd) break;
      const nameToks = tk.slice(nameStart);
      if (nameToks.some(x => { const w = nw(x); return SIGN_WORDS.has(w) || STOP.has(w) || !w || !isAlpha(first(w)); })) continue;
      if (nameToks.slice(0, -1).some(x => '.,!?'.includes(lastCh(x)))) continue;
      let j = nameStart, firstPh = '';
      while (j > gEnd) {
        let matched = 0;
        for (const ph of SIGN_PHRASES) {
          const st = j - ph.length;
          if (st < gEnd) continue;
          let ok = true;
          for (let q = 0; q < ph.length; q++) if (nw(tk[st + q]) !== ph[q]) { ok = false; break; }
          if (ok) for (let q = 0; q < ph.length - 1; q++) if ('.,!?'.includes(lastCh(tk[st + q]))) { ok = false; break; }
          if (ok) { matched = ph.length; break; }
        }
        if (matched === 0) break;
        j -= matched;
        firstPh = tk.slice(j, j + matched).join(' ');
      }
      if (j === nameStart) continue;
      if (j > gEnd && anyPunct && !'.,!?'.includes(lastCh(tk[j - 1]))) continue;
      sStart = j; signoff = firstPh; name = nameToks.join(' ');
      break;
    }
    if (gEnd === 0 && sStart < 0) return null;
    const bodyEnd = sStart >= 0 ? sStart : n;
    if (bodyEnd <= gEnd) return null;
    const parts = [];
    if (gEnd > 0) parts.push(capFirst(rstrip(tk.slice(0, gEnd).join(' '), ',.! ')) + ',');
    parts.push(capFirst(rstrip(tk.slice(gEnd, bodyEnd).join(' '), ',; ')));
    if (sStart >= 0) parts.push(capFirst(strip(signoff, TC_STRIP)) + ',\n' + capFirst(strip(name, TC_STRIP)));
    return parts.join('\n\n');
  }

  // ------------------------------------------------------------- NumberNormalizer
  const NUMERIC_CONTEXT = new Set(('dollars dollar cents cent bucks rupees rupee euros euro pounds pound kg kgs kilograms kilogram grams gram mg lbs ' +
    'miles mile km kilometers meters meter cm mm minutes minute mins min hours hour hrs seconds secs ' +
    "days day weeks week months month years year am pm o'clock gb mb kb tb px percent degrees degree x " +
    'room page pages chapter step steps version floor level number line lines apartment unit grade rank item items ' +
    'question port figure table section phase part age id').split(' '));
  const PRONOUN_ONE_DET = new Set(('the this that other another no any each every which some such only latest last next first best ' +
    'second third fourth fifth sixth seventh eighth ninth tenth little big').split(' '));
  const RANK_AFTER_ONE = new Set(('is was priority fan rule reason thing choice goal spot seed hit concern problem issue pick ' +
    'favourite favorite song place').split(' '));
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
  // Kotlin rep.takeWhile { it.isDigit() }.toIntOrNull(): null when empty or past Int range
  function intPrefix(rep) {
    const m = rep.match(R('^\\d*', ''))[0];
    if (!m) return null;
    const v = BigInt(m);
    return v > 2147483647n ? null : Number(v);
  }

  // Trailing sentence punctuation on a number word ("five." -> ["five", "."]), as Kotlin splitPunct.
  function splitPunct(word) {
    const m = word.match(/^(.*?)([.,!?;:]+)$/s);
    if (!m || !m[1]) return [word.toLowerCase(), ''];
    return [m[1].toLowerCase(), m[2]];
  }
  const MERIDIEM = new Set(['am', 'pm', 'a.m.', 'p.m.', 'a.m', 'p.m']);
  const A_MULT = new Set(['hundred', 'thousand']);
  const DEC_SCALES = new Set(['thousand', 'million', 'billion', 'trillion']);
  const DIGIT_WORD = { zero: '0', oh: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
  const DIGIT_CUES = new Set(('code pin number reference ref extension ext passcode password otp zip postcode id account phone mobile ' +
    'ticket order booking confirmation tracking serial flight').split(' '));

  function numberNormalize(text) {
    if (!text) return text;
    // line by line, so structure built earlier keeps its line breaks
    if (text.includes('\n')) return text.split('\n').map(numberNormalize).join('\n');
    const words0 = ws(text);
    if (!words0.length) return text;
    let out = normalizeWords(joinDigitRuns(words0));
    out = sub('(?<![\\p{L}\\p{N}_/])24 seven\\b', '24/7', out, 'i');
    return sub('(\\d)\\s+(?:percent|per cent)\\b', '$1%', out, 'i');
  }
  // "the door code is four four two one" -> 4421 (3+ spoken digits right after a code cue)
  function joinDigitRuns(words) {
    const out = [];
    let i = 0;
    const n = words.length;
    while (i < n) {
      let cueAt = -1;
      for (let back = 1; back <= 3; back++) {
        if (out.length - back < 0) break;
        const w = nstrip(out[out.length - back]);
        if (DIGIT_CUES.has(w)) { cueAt = back; break; }
        if (!['is', 'was', "it's", 'its', 'are'].includes(w)) break;
      }
      if (cueAt > 0) {
        let sb = '', j = i, count = 0, punct = '';
        while (j < n) {
          const [w, p] = splitPunct(words[j]);
          if (w === 'double' && !p && j + 1 < n) {
            const [w2, p2] = splitPunct(words[j + 1]);
            if (!Object.hasOwn(DIGIT_WORD, w2)) break;
            if (w2 === 'oh' && count === 0) break;
            const d = DIGIT_WORD[w2];
            sb += d + d; count += 2; j += 2; punct = p2;
            if (p2) break;
            continue;
          }
          if (!Object.hasOwn(DIGIT_WORD, w)) break;
          if (w === 'oh' && count === 0) break;
          sb += DIGIT_WORD[w]; count++; j++; punct = p;
          if (p) break;
        }
        if (count >= 3) { out.push(sb + punct); i = j; continue; }
      }
      out.push(words[i]); i++;
    }
    return out;
  }
  function normalizeWords(words) {
    const out = [];
    let i = 0;
    while (i < words.length) {
      const time = tryConsumeClockTime(words, i);
      if (time) {
        const [c, rep] = time;
        if (rep !== null) out.push(rep); else out.push(...words.slice(i, i + c));
        i += c;
        continue;
      }
      const [consumed, rep, punct] = tryConsumeNumber(words, i);
      if (consumed > 0 && shouldDigitize(words, i, consumed, rep, punct !== '')) { out.push(rep + punct); i += consumed; }
      else if (consumed > 0) { out.push(...words.slice(i, i + consumed)); i += consumed; }
      else { out.push(words[i]); i++; }
    }
    return out.join(' ');
  }
  function tryConsumeClockTime(words, start) {
    const [hw, hp] = splitPunct(words[start]);
    if (hp) return null;
    const hour = ONES.get(hw);
    if (hour === undefined || hour < 1 || hour > 12) return null;
    if (start > 0) {
      const [pw, pp] = splitPunct(words[start - 1]);
      if (!pp && (TENS.has(pw) || MULT.has(pw))) return null;
    }
    let i = start + 1;
    if (i >= words.length) return null;
    const [m1, p1] = splitPunct(words[i]);
    let minutes, lastPunct = p1;
    const t = TENS.get(m1);
    if (t !== undefined && t <= 50) {
      minutes = t; i++;
      if (!p1 && i < words.length) {
        const [nw, np] = splitPunct(words[i]);
        const o = ONES.get(nw);
        if (o !== undefined && o >= 1 && o <= 9) { minutes += o; lastPunct = np; i++; }
      }
    } else {
      const o = ONES.get(m1);
      if (o === undefined || o < 10 || o > 19) return null;
      minutes = o; i++;
    }
    const after = i < words.length ? splitPunct(words[i]) : null;
    if (!lastPunct && after && MERIDIEM.has(after[0])) return [i - start, `${hour}:${String(minutes).padStart(2, '0')}`];
    return [i - start, null];
  }
  function shouldDigitize(words, start, consumed, rep, endsSentence) {
    if (rep.includes('.')) return true;
    if (consumed >= 2) return true;
    const prev = start - 1 >= 0 ? nstrip(words[start - 1]) : null;
    const nxt = !endsSentence && start + consumed < words.length ? nstrip(words[start + consumed]) : null;
    const word = nstrip(words[start]) || '';
    if (word === 'one' && (PRONOUN_ONE_DET.has(prev) || nxt === 'of')) return false;
    if (word === 'one' && (prev === 'number' || prev === 'step') && RANK_AFTER_ONE.has(nxt)) return false;
    if (rep && isAlpha(lastCh(rep))) { // ordinal
      const v = intPrefix(rep) || 0;
      return (NUMERIC_CONTEXT.has(nxt) && v >= 1) || v >= 10;
    }
    if (NUMERIC_CONTEXT.has(prev) || NUMERIC_CONTEXT.has(nxt)) return true;
    if (prev === '$' || prev === '#' || nxt === '%') return true;
    const value = intPrefix(rep);
    if (value === null) return false;
    return value >= 10;
  }
  function tryConsumeNumber(words, start) {
    let i = start, total = 0n, current = 0n, consumed = 0;
    let isOrd = false, ordSuffix = '', hasDec = false, decDigits = [], hasNum = false, lastBareOnes = false;
    let punct = '', scaleSuffix = '';
    const n = words.length;
    while (i < n) {
      const [w, wp] = splitPunct(words[i]);
      const take = () => { punct = wp; return wp !== ''; };
      if (w === 'and' && hasNum && !wp) { i++; consumed++; continue; }
      if (w === 'a' && !hasNum) {
        if (!wp && i + 1 < n && A_MULT.has(splitPunct(words[i + 1])[0])) { current = 1n; hasNum = true; i++; consumed++; continue; }
        break;
      }
      if (w === 'point' && hasNum && !hasDec && !wp) {
        hasDec = true; i++; consumed++;
        while (i < n) {
          const [dw, dp] = splitPunct(words[i]);
          const v = ONES.get(dw);
          if (v !== undefined && v <= 9) { decDigits.push(v); i++; consumed++; punct = dp; if (dp) break; } else break;
        }
        if (!decDigits.length) { hasDec = false; consumed--; i--; }
        else if (!punct && i < n) {
          const [sw, sp] = splitPunct(words[i]);
          if (DEC_SCALES.has(sw)) { scaleSuffix = ' ' + sw; punct = sp; i++; consumed++; }
        }
        break;
      }
      if (ORD_MULT.has(w)) {
        const [val, suf] = ORD_MULT.get(w);
        if (current === 0n) current = 1n;
        total = i32(total + i32(current * BigInt(val))); current = 0n;
        isOrd = true; ordSuffix = suf; hasNum = true; consumed++; i++; take();
        break;
      }
      if (ORD_TENS.has(w)) {
        if (lastBareOnes) break;
        const [val, suf] = ORD_TENS.get(w);
        current = i32(current + BigInt(val)); isOrd = true; ordSuffix = suf; hasNum = true; consumed++; i++; take();
        break;
      }
      if (ORD_ONES.has(w)) {
        if (lastBareOnes) break; // "at nine second" is two words, not "11nd"
        const [val, suf] = ORD_ONES.get(w);
        current = i32(current + BigInt(val)); isOrd = true; ordSuffix = suf; hasNum = true; consumed++; i++; take();
        break;
      }
      if (MULT.has(w)) {
        if (!hasNum) break;
        const mult = BigInt(MULT.get(w));
        if (current === 0n) current = 1n;
        if (mult >= 1000n) { total = i32(i32(total + current) * mult); current = 0n; }
        else current = i32(current * mult);
        hasNum = true; lastBareOnes = false; consumed++; i++;
        if (take()) break; else continue;
      }
      if (TENS.has(w)) {
        if (lastBareOnes) break;
        current = i32(current + BigInt(TENS.get(w))); hasNum = true; lastBareOnes = false; consumed++; i++;
        if (take()) break; else continue;
      }
      if (ONES.has(w)) {
        if (lastBareOnes) break;
        current = i32(current + BigInt(ONES.get(w))); hasNum = true; lastBareOnes = true; consumed++; i++;
        if (take()) break; else continue;
      }
      break;
    }
    if (!hasNum) return [0, '', ''];
    while (consumed > 0 && words[start + consumed - 1].toLowerCase() === 'and') consumed--;
    if (consumed <= 0) return [0, '', ''];
    total = i32(total + current);
    if (hasDec) return [consumed, `${total}.` + decDigits.join('') + scaleSuffix, punct];
    if (isOrd) return [consumed, `${total}${ordSuffix}`, punct];
    return [consumed, `${total}`, punct];
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
    // "next paragraph" too, unless it names one ("the next paragraph explains...")
    r = sub('(?:\\b(\\w+)\\s+)?\\bnext\\s+paragraph\\b', (m0, prev) => {
      prev = prev || '';
      if (['the', 'this', 'that', 'a'].includes(prev.toLowerCase())) return m0;
      return prev ? prev + '\n\n' : '\n\n';
    }, r, 'i');
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
  const LF_END_MARKER = "(?<=[,.;!?])\\s*(?:and\\s+)?(?:that['’]s\\s+(?:it|all|the\\s+list|everything)|end\\s+of\\s+(?:the\\s+)?list|done)[.!]?\\s*$";
  // A lead-in above a list ends with a colon ("Shopping list:"); a sentence keeps its own end.
  function lfLeadLine(s0) {
    const s = rstrip(strip(s0), ',;');
    if (!s) return s;
    const last = lastCh(s);
    if (last === ':') return s;
    if (last === '.' && s.split(/\s+/u).length <= 4) return s.slice(0, -1) + ':';
    if ('.!?'.includes(last)) return s;
    return s + ':';
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
    const lead = lfLeadLine(text.slice(0, run[0][0]));
    if (lead) sb += lead + '\n';
    for (let k = 0; k < run.length; k++) {
      const m = run[k];
      const itemEnd = k + 1 < run.length ? run[k + 1][0] : text.length;
      let item = strip(text.slice(m[1], itemEnd));
      if (k === run.length - 1) item = strip(item.replace(R(LF_END_MARKER, 'i'), '')); // "... the lump. Done."
      item = rstrip(item, ',;');
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
    if (!isCode) text = textCommands(text);
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

  const api = { process, explain, joinSpelledLetters, detectAndResolve, removeFillers, spokenNormalize, textCommands, numberNormalize, listFormat, capitalizeSentences };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KKText = api;
})(typeof self !== 'undefined' ? self : this);
