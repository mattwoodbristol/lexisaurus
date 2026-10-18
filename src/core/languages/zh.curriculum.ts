// Mandarin curriculum after the 20 imported lessons: the topics from the author's original lesson plan
// that were never taught, then further HSK 4 grammar. Lesson generation takes the next one
// that has no lesson yet. Course numbering continues from 21.
export interface CurriculumItem {
  title: string;
  level: string;
  focus: string;
}

export const ZH_CURRICULUM: CurriculumItem[] = [
  { title: 'Duration and frequency', level: 'HSK 3-4', focus: 'Duration and frequency phrases follow the verb: 我学了两年中文, 我去过三次. Duration with objects (repeat the verb or put duration before the object).' },
  { title: '离 for distance', level: 'HSK 3-4', focus: '离 = distance from a fixed point (我家离公司很近) contrasted with 从…到 for movement from A to B.' },
  { title: 'Resultative complements', level: 'HSK 3-4', focus: 'Verb + result: 看完, 听懂, 找到, 做好, 洗干净; negation with 没; potential forms 看得懂/看不懂.' },
  { title: 'Directional complements', level: 'HSK 4', focus: 'Simple (来/去) and compound (上来, 下去, 进来, 出去, 回来, 起来) complements, and where the object goes.' },
  { title: '因为…所以 and causal chains', level: 'HSK 2-4', focus: '因为 A, 所以 B; 由于; 因此; using only one of the pair; explaining reasons in conversation.' },
  { title: '不但…而且 and 不仅…还', level: 'HSK 4', focus: 'Not only… but also: subject placement when the subjects are the same or different.' },
  { title: 'Review and error clinic', level: 'All', focus: 'Mixed review of lessons 1-26 targeting the learner’s recurring errors: 就/也 position, 没 + 了, 不有, measure words, 骑 vs 开, 得/的/地.' },
  { title: '一边…一边 and 正在…呢', level: 'HSK 3', focus: 'Simultaneous actions and actions in progress.' },
  { title: '只要…就 and 只有…才', level: 'HSK 4', focus: 'Sufficient versus necessary conditions.' },
  { title: '难道 and rhetorical questions', level: 'HSK 4', focus: 'Rhetorical questions with 难道…吗 and 不是…吗.' },
];
