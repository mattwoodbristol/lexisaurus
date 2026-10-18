// Remove pinyin that slipped into Claude's Hanzi-only output.
// Conservative: only strips bracketed romanisation that sits next to Han text, and
// standalone lines that are entirely pinyin.

const TONED = 'āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜĀÁǍÀĒÉĚÈĪÍǏÌŌÓǑÒŪÚǓÙǕǗǙǛ';
// One or more syllables; tone digits may be glued together ("tu2shu1guan3").
const PINYIN_WORD = `(?:[A-Za-zü${TONED}]+[0-5]?)+`;
const PINYIN_RUN = `${PINYIN_WORD}(?:['’ ]${PINYIN_WORD})*`;
const HAN = '[\\u3400-\\u4dbf\\u4e00-\\u9fff]';

const bracketedAfterHan = new RegExp(`(${HAN})\\s*[（(\\[]\\s*${PINYIN_RUN}\\s*[）)\\]]`, 'g');
const bracketedBeforeHan = new RegExp(`[（(\\[]\\s*${PINYIN_RUN}\\s*[）)\\]]\\s*(${HAN})`, 'g');
// A whole line of pinyin: must contain a tone mark or tone digit so English prose is never removed.
const pureToneLine = new RegExp(`^\\s*(?=.*[${TONED}0-5])${PINYIN_RUN}[.,!?。，！？]*\\s*$`);

export function stripPinyin(text: string): string {
  let out = text.replace(bracketedAfterHan, '$1').replace(bracketedBeforeHan, '$1');
  out = out
    .split('\n')
    .filter((line) => !pureToneLine.test(line))
    .join('\n');
  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
