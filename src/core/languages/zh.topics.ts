// Seed conversation topics for Mandarin. Scenario seeds are English instructions for the tutor.
// Used only when a language has no topics yet; a course pack's topics.json replaces them, and the
// learner's "about you" text lets the tutor personalise any of them.
export interface TopicSeed {
  name: string;
  tags: string[];
  scenario: string;
}

export const ZH_TOPICS: TopicSeed[] = [
  { name: '周末计划', tags: ['plans', 'daily'], scenario: 'Friends planning what to do this weekend; compare options and agree on one.' },
  { name: '在咖啡馆点东西', tags: ['food', 'shopping'], scenario: 'Ordering drinks and a snack in a café; the barista asks follow-up questions.' },
  { name: '骑自行车', tags: ['sport', 'hobbies'], scenario: 'Chatting about a recent bike ride or walk: route, weather, how it felt.' },
  { name: '天气和季节', tags: ['nature', 'daily'], scenario: 'Talking about this week’s weather and favourite seasons.' },
  { name: '工作中的一天', tags: ['work', 'daily'], scenario: 'Describing a typical working day, meetings and what was hard today.' },
  { name: '我的工作', tags: ['work', 'tech'], scenario: 'Explaining what you do at work to a curious friend: what a project involves and why it matters.' },
  { name: '照顾宝宝', tags: ['family', 'feelings'], scenario: 'A friend asks how life is with a new baby: sleep, feeding, small milestones.' },
  { name: '家人', tags: ['family'], scenario: 'Introducing family members and what each person is like.' },
  { name: '做饭', tags: ['food', 'home'], scenario: 'Swapping recipes; describe how to cook a favourite dish step by step.' },
  { name: '去饭馆吃饭', tags: ['food', 'city'], scenario: 'At a Chinese restaurant: choosing dishes, asking about spice, paying.' },
  { name: '旅行经历', tags: ['travel'], scenario: 'Telling the story of a memorable trip: where, how you got there, what happened.' },
  { name: '订酒店', tags: ['travel', 'shopping'], scenario: 'Phoning a hotel to book a room, asking about price and facilities.' },
  { name: '问路', tags: ['travel', 'city'], scenario: 'Lost in a Chinese city, asking a local for directions to the station.' },
  { name: '坐火车和飞机', tags: ['travel'], scenario: 'Comparing trains and planes for a trip; buying a ticket at the counter.' },
  { name: '在上海', tags: ['travel', 'culture'], scenario: 'Visiting a friend who lives in Shanghai; what to see and eat.' },
  { name: '我的城市', tags: ['city', 'culture'], scenario: 'Describing your home town to someone who has never been: neighbourhoods, sights, weather.' },
  { name: '买东西', tags: ['shopping', 'money'], scenario: 'Shopping for clothes at a market and bargaining over the price.' },
  { name: '看病', tags: ['health'], scenario: 'At the doctor with a cold: describe symptoms and understand advice.' },
  { name: '运动和健身', tags: ['health', 'sport'], scenario: 'Talking about exercise routines, favourite sports and staying fit.' },
  { name: '睡眠', tags: ['health', 'daily'], scenario: 'Comparing sleep habits; tips for sleeping better.' },
  { name: '电影', tags: ['culture', 'hobbies'], scenario: 'Recommending a film, describing the plot and whether it was moving or funny.' },
  { name: '音乐', tags: ['culture', 'hobbies'], scenario: 'Favourite music and a memorable concert.' },
  { name: '读书', tags: ['culture', 'hobbies'], scenario: 'A book you are reading: what it is about and whether you would recommend it.' },
  { name: '学中文', tags: ['education', 'opinion'], scenario: 'Why you are learning Chinese, what is hard, what helps.' },
  { name: '学校和童年', tags: ['education', 'family'], scenario: 'Memories of school and childhood.' },
  { name: '科技和手机', tags: ['tech', 'opinion'], scenario: 'How phones and apps change daily life; good and bad sides.' },
  { name: '人工智能', tags: ['tech', 'news'], scenario: 'Opinions on AI: useful at work? worrying?' },
  { name: '气候变化', tags: ['nature', 'news', 'opinion'], scenario: 'Discussing climate change and what households can do.' },
  { name: '新闻', tags: ['news', 'opinion'], scenario: 'Talking about a recent news story and your view of it.' },
  { name: '节日', tags: ['culture', 'family'], scenario: 'How a festival is celebrated (Spring Festival, Christmas, Mid-Autumn).' },
  { name: '中国文化', tags: ['culture'], scenario: 'Questions about Chinese customs: tea, food etiquette, greetings.' },
  { name: '宠物', tags: ['home', 'family'], scenario: 'Pets: cats or dogs, their personalities and funny habits.' },
  { name: '搬家和住房', tags: ['home', 'money'], scenario: 'Looking for a flat or house: location, rent, what matters most.' },
  { name: '理财', tags: ['money', 'plans'], scenario: 'Saving money, budgeting and big purchases.' },
  { name: '朋友', tags: ['feelings', 'daily'], scenario: 'Catching up with an old friend: what has changed since you last met.' },
  { name: '心情和压力', tags: ['feelings', 'health'], scenario: 'Talking about a stressful week and how you relax.' },
  { name: '未来的计划', tags: ['plans', 'opinion'], scenario: 'Plans and hopes for the next five years.' },
  { name: '大自然', tags: ['nature', 'travel'], scenario: 'A walk in the countryside or by the sea; what you saw.' },
  { name: '城市交通', tags: ['city', 'opinion'], scenario: 'Buses, cycle lanes and traffic: how to get around the city.' },
  { name: '比较中国和英国', tags: ['culture', 'opinion'], scenario: 'Comparing everyday life in China and the UK.' },
];
