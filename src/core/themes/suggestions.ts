// Built-in theme ideas, offered before any are written. Everyday detail a native speaker learns
// as a child and a classroom course skips. Names are in English; Claude writes the theme in the
// learner's own language whatever the name is written in.
export interface ThemeIdea {
  name: string;
  /** What the pack should go into. */
  hint: string;
}

export const THEME_IDEAS: ThemeIdea[] = [
  { name: 'The body', hint: 'Body parts in detail (elbow, ankle, eyelash, knuckle), aches and injuries, washing and dressing.' },
  { name: 'Animals and their bodies', hint: 'Farm, wild and pet animals; paws, claws, beaks, fur, tails, hooves; the sounds they make and what they do.' },
  { name: 'Tennis', hint: 'The court, strokes, scoring, serving and faults; talking about a match.' },
  { name: 'Football', hint: 'Positions, the pitch, fouls, scoring; commentary and talking about a game.' },
  { name: 'In the kitchen', hint: 'Utensils, appliances, cooking verbs (chop, fry, stir, drain), recipes and quantities.' },
  { name: "At the doctor's", hint: 'Symptoms, describing pain, medicines, appointments and instructions.' },
  { name: 'Buildings and the home', hint: 'Kinds of building and their parts (roof, gutter, balcony, stairs, lift), rooms, fittings (tap, socket, radiator, boiler, hinge, light switch) and appliances, and describing what has broken.' },
  { name: 'Furniture and housework', hint: 'Furniture room by room, where things are (on, under, next to), chores and cleaning things.' },
  { name: 'Fixing things and DIY', hint: 'Tools, materials, verbs like drill, screw, glue, paint; describing what is broken.' },
  { name: 'Weather and the seasons', hint: 'Every kind of weather, temperature, forecasts, what you wear and do in each season.' },
  { name: 'Clothes and getting dressed', hint: 'Garments, parts of clothes (collar, sleeve, zip), fabrics, fit, shopping for clothes.' },
  { name: 'Feelings and moods', hint: 'Emotions beyond happy and sad, how they show, talking about how you feel and why.' },
  { name: 'Garden and plants', hint: 'Plants, parts of a plant, garden tools, growing, insects and birds in the garden.' },
  { name: 'Cars and driving', hint: 'Parts of a car, driving manoeuvres, road signs, breakdowns and the garage.' },
  { name: 'Countryside and landscape', hint: 'Hills, rivers, woods, fields, coast; describing a walk or a view.' },
  { name: 'Family and relationships', hint: 'Extended family, in-laws, stages of life, describing people and how they get on.' },
  { name: 'At the market', hint: 'Fruit, vegetables, meat, fish, cheese; quantities, ripeness, haggling and small talk.' },
  { name: 'Travel by train and plane', hint: 'Stations, airports, tickets, delays, luggage, announcements.' },
  { name: 'Daily routine', hint: 'Every step of a day in detail, reflexive verbs, time expressions.' },
  { name: 'School and childhood', hint: 'Subjects, classroom objects, playground games, what children say and do.' },
  { name: 'Cycling', hint: 'Parts of a bike, riding, punctures and repairs, routes.' },
];
