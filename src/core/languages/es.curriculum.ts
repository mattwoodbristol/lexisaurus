// Built-in Spanish curriculum, A1 to B2, used until a course pack defines the plan. Lesson
// generation takes the next one that has no lesson yet.
import type { CurriculumItem } from './zh.curriculum';

export const ES_CURRICULUM: CurriculumItem[] = [
  { title: 'Ser and estar: the basics', level: 'A1', focus: 'ser for identity, origin, profession and time (soy inglés, es médica, son las tres); estar for location and states (está en casa, estoy cansado).' },
  { title: 'Gender, articles and agreement', level: 'A1', focus: 'el/la/los/las, un/una/unos/unas; noun gender patterns and exceptions (el día, la mano, el problema); adjective agreement and position.' },
  { title: 'Present tense of regular verbs', level: 'A1', focus: '-ar, -er and -ir endings (hablo, como, vivo); dropping subject pronouns; asking and answering everyday questions.' },
  { title: 'Hay, tener and common irregular verbs', level: 'A1', focus: 'hay vs estar for existence and location; tener and tener que; ir, hacer, poder, querer in the present.' },
  { title: 'Stem-changing verbs', level: 'A1-A2', focus: 'e→ie (quiero, empiezo), o→ue (puedo, duermo), e→i (pido); which forms keep the stem (nosotros, vosotros).' },
  { title: 'Gustar and similar verbs', level: 'A2', focus: 'me gusta / me gustan, a mí también / a mí tampoco; encantar, interesar, doler, apetecer; a + person for emphasis or clarity.' },
  { title: 'Reflexive verbs and daily routine', level: 'A2', focus: 'levantarse, ducharse, acostarse; pronoun position with conjugated verbs, infinitives and gerunds; reflexive vs non-reflexive meaning.' },
  { title: 'Ir a + infinitive and talking about plans', level: 'A2', focus: 'voy a + infinitive for plans; pensar + infinitive; time expressions for the future (mañana, la semana que viene).' },
  { title: 'Estar + gerundio', level: 'A2', focus: 'Actions in progress (estoy trabajando); irregular gerunds (durmiendo, leyendo); when Spanish uses the simple present instead.' },
  { title: 'Pretérito perfecto', level: 'A2', focus: 'he/has/ha + participle; irregular participles (hecho, dicho, visto, escrito); hoy, esta semana, ya, todavía no, alguna vez.' },
  { title: 'Pretérito indefinido', level: 'A2', focus: 'Regular and key irregular forms (fui, hice, tuve, estuve); finished past time (ayer, el año pasado); perfecto vs indefinido in Spain and Latin America.' },
  { title: 'Pretérito imperfecto', level: 'A2-B1', focus: 'Regular forms and ser, ir, ver; habits and descriptions in the past (cuando era pequeño, jugaba...).' },
  { title: 'Indefinido vs imperfecto', level: 'B1', focus: 'Background vs events in a story (llovía cuando salí); verbs that change meaning (conocí vs conocía, quise vs quería).' },
  { title: 'Direct and indirect object pronouns', level: 'B1', focus: 'lo/la/los/las and le/les; combining them (se lo doy); position before verbs and attached to infinitives, gerunds and commands.' },
  { title: 'Por and para', level: 'B1', focus: 'para for purpose, destination, deadline and recipient; por for cause, through, exchange, duration and means; fixed expressions (por fin, para nada).' },
  { title: 'Comparisons and superlatives', level: 'A2-B1', focus: 'más/menos... que, tan... como, tanto como; mejor, peor, mayor, menor; el más... de; -ísimo.' },
  { title: 'Imperatives', level: 'B1', focus: 'tú and usted commands, affirmative and negative (habla / no hables, hable / no hable); irregular tú commands (ven, pon, haz, di); pronouns with commands.' },
  { title: 'Futuro simple and condicional', level: 'B1', focus: 'Forms and irregular stems (tendré, haré, podría); predictions, promises and guesses (serán las diez); polite requests and advice (yo que tú...).' },
  { title: 'Present subjunctive: wishes and feelings', level: 'B1', focus: 'Forms of the present subjunctive; querer que, esperar que, me alegra que, ojalá; same subject takes the infinitive.' },
  { title: 'Present subjunctive: doubt, opinion and advice', level: 'B1-B2', focus: 'no creo que, dudo que, es posible que, es importante que, te recomiendo que; creo que + indicative vs no creo que + subjunctive.' },
  { title: 'Subjunctive after time conjunctions', level: 'B2', focus: 'cuando, en cuanto, hasta que, antes de que with the subjunctive for future events (cuando llegues, llámame) and the indicative for habits or the past.' },
  { title: 'Relative pronouns', level: 'B1-B2', focus: 'que, quien, donde, lo que; el/la que, el cual after prepositions (la empresa para la que trabajo); subjunctive in relatives for unknown things (busco a alguien que hable alemán).' },
  { title: 'Pluperfect and reported speech', level: 'B2', focus: 'había + participle; changing tenses when reporting (dijo que estaba cansado, que vendría, que lo había hecho).' },
  { title: 'Imperfect subjunctive and conditionals', level: 'B2', focus: 'Forms of the imperfect subjunctive (-ra); si tuviera tiempo, viajaría; ojalá pudiera; como si + imperfect subjunctive.' },
];
