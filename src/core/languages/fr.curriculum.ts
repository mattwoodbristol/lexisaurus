// Built-in French curriculum, A1 to B2, used until a course pack defines the plan. Lesson
// generation takes the next one that has no lesson yet.
import type { CurriculumItem } from './zh.curriculum';

export const FR_CURRICULUM: CurriculumItem[] = [
  { title: 'Être and avoir', level: 'A1', focus: 'Present tense of être and avoir; c’est vs il est; avoir for age, hunger, cold (j’ai trente ans, j’ai faim).' },
  { title: 'Gender, articles and agreement', level: 'A1', focus: 'le/la/l’/les, un/une/des; noun gender patterns; adjective agreement and position (une petite maison, un livre intéressant).' },
  { title: 'Present tense of -er verbs', level: 'A1', focus: 'parler, aimer, habiter; spelling changes (mangeons, commençons, j’achète, j’appelle); elision with je.' },
  { title: 'Negation and questions', level: 'A1', focus: 'ne... pas, ne... jamais, ne... plus; pas de after a negative; questions with intonation, est-ce que and inversion; dropping ne in speech.' },
  { title: 'Irregular verbs: aller, faire, venir, prendre', level: 'A1', focus: 'Present forms; aller à + place and au/aux; faire for weather and activities; venir de.' },
  { title: 'Partitive articles', level: 'A1-A2', focus: 'du, de la, de l’, des for quantities you cannot count; de after negation and quantities (pas de pain, beaucoup de temps); aimer + le vs manger + du.' },
  { title: 'Reflexive verbs and daily routine', level: 'A2', focus: 'se lever, se laver, s’habiller; pronoun position in negatives and with infinitives (je vais me coucher).' },
  { title: 'Futur proche and talking about plans', level: 'A2', focus: 'aller + infinitive; time expressions (demain, la semaine prochaine, ce soir); negating the futur proche.' },
  { title: 'Passé composé with avoir', level: 'A2', focus: 'avoir + participle; irregular participles (fait, pris, vu, eu, été, dit); negation and adverbs (je n’ai pas encore mangé).' },
  { title: 'Passé composé with être', level: 'A2', focus: 'The être verbs (aller, venir, partir, naître...) and all reflexive verbs; agreement of the participle with the subject.' },
  { title: 'Imparfait', level: 'A2-B1', focus: 'Forms from the nous stem, être as the exception; habits and descriptions in the past (quand j’étais petit, on allait...).' },
  { title: 'Passé composé vs imparfait', level: 'B1', focus: 'Background vs events in a story (il pleuvait quand je suis sorti); être en train de; verbs that shift meaning (j’ai su vs je savais).' },
  { title: 'Direct and indirect object pronouns', level: 'B1', focus: 'le/la/les and lui/leur; order when combined (je le lui donne); position with infinitives and in the passé composé, with past participle agreement (je les ai vues).' },
  { title: 'Y and en', level: 'B1', focus: 'y for places and à + thing (j’y vais, j’y pense); en for de + thing and quantities (j’en veux deux); il y a and il y en a.' },
  { title: 'Comparisons and superlatives', level: 'A2-B1', focus: 'plus/moins/aussi... que, autant de; meilleur vs mieux; le plus..., le moins...; the superlative after the noun (la ville la plus belle).' },
  { title: 'Imperatives', level: 'B1', focus: 'tu, nous and vous commands; dropping -s for -er verbs (parle); irregular être, avoir, savoir; pronouns after affirmative commands (donne-le-moi) and before negative ones.' },
  { title: 'Futur simple and conditionnel présent', level: 'B1', focus: 'Forms and irregular stems (j’aurai, je ferai, je pourrais); predictions and promises; polite requests and advice (je voudrais, tu devrais).' },
  { title: 'Relative pronouns qui, que, où, dont', level: 'B1', focus: 'qui as subject, que as object, où for place and time, dont for de + noun (le livre dont je parle); ce qui / ce que.' },
  { title: 'Present subjunctive: necessity and wishes', level: 'B1-B2', focus: 'Forms from the ils stem, irregular être, avoir, aller, faire, pouvoir; il faut que, vouloir que, je préfère que; same subject takes the infinitive.' },
  { title: 'Present subjunctive: feelings, doubt and conjunctions', level: 'B2', focus: 'je suis content que, j’ai peur que, je ne pense pas que; bien que, pour que, avant que; penser que + indicative vs ne pas penser que + subjunctive.' },
  { title: 'Plus-que-parfait and reported speech', level: 'B2', focus: 'avoir/être in the imparfait + participle; tense changes when reporting (il a dit qu’il était fatigué, qu’il viendrait, qu’il l’avait fait).' },
  { title: 'Si clauses', level: 'B2', focus: 'si + present → future; si + imparfait → conditionnel (si j’avais le temps, je voyagerais); si + plus-que-parfait → conditionnel passé.' },
  { title: 'Lequel and prepositions with relatives', level: 'B2', focus: 'lequel, laquelle, lesquels after prepositions (l’entreprise pour laquelle je travaille); auquel, duquel; à qui for people.' },
  { title: 'Gérondif and present participle', level: 'B2', focus: 'en + -ant for simultaneous actions and manner (en marchant, en travaillant dur); tout en for contrast; the present participle in writing.' },
];
