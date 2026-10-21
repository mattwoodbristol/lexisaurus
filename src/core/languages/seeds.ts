// Built-in content per language, used until a course pack takes over: conversation topics and the
// lesson plan. Adding a language = add its topics (and, optionally, a curriculum) here.
import { ZH_TOPICS, type TopicSeed } from './zh.topics';
import { ZH_CURRICULUM, type CurriculumItem } from './zh.curriculum';
import { ES_TOPICS } from './es.topics';
import { ES_CURRICULUM } from './es.curriculum';
import { FR_TOPICS } from './fr.topics';
import { FR_CURRICULUM } from './fr.curriculum';

export const TOPIC_SEEDS: Record<string, TopicSeed[]> = { zh: ZH_TOPICS, es: ES_TOPICS, fr: FR_TOPICS };

export const CURRICULA: Record<string, CurriculumItem[]> = { zh: ZH_CURRICULUM, es: ES_CURRICULUM, fr: FR_CURRICULUM };
