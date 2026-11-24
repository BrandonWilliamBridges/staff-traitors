// Starter mission library. The Game Master edits titles, answers and rewards
// before opening any of them. Code answers are printed on cards and hidden in
// staff-only areas. Several accepted answers are separated by "|".
export const STARTER_MISSIONS = [
  // Department challenges
  { title: 'Tower of Power', kind: 'department', checkMethod: 'photo', reward: 300, description: 'At Wednesday lunch, your department builds the tallest free-standing tower in the staff lounge from 20 sheets of scrap paper and one roll of tape. Photo of the tower only, no people needed.' },
  { title: 'Department Haiku', kind: 'department', checkMethod: 'manual', reward: 200, description: 'Your department writes one haiku about your subject or your job and one person submits it here. Five, seven, five syllables.' },
  { title: 'Lounge Makeover', kind: 'department', checkMethod: 'photo', reward: 250, description: 'Leave one small, removable decoration in the staff lounge that shows off your department. Take it home on Friday.', awardsShield: true },
  { title: 'Fact Swap', kind: 'department', checkMethod: 'manual', reward: 200, description: 'Send one surprising fact about your department to the Game Master. The best three are read at the roundtable.' },
  { title: 'Mascot Sketch', kind: 'department', checkMethod: 'photo', reward: 200, description: 'Draw your department as an animal. Photo of the drawing only.' },
  // Scavenger hunts (code cards)
  { title: 'Copy Room Clue', kind: 'individual', checkMethod: 'code', answer: 'LANTERN', reward: 100, description: 'A card is hidden somewhere in the copy room. Type the word printed on it.' },
  { title: 'Lounge Clue', kind: 'individual', checkMethod: 'code', answer: 'COMPASS', reward: 100, description: 'A card is hidden in the staff lounge. Type the word on it. Leave the card where you found it.' },
  { title: 'Mailroom Clue', kind: 'individual', checkMethod: 'code', answer: 'HARBOR', reward: 100, description: 'A card is taped somewhere near the staff mailboxes, never inside one. Type its word.' },
  { title: 'Library Clue', kind: 'individual', checkMethod: 'code', answer: 'QUILL', reward: 100, description: 'A card is hidden in the staff workroom of the library before school. Type its word.' },
  { title: 'Six Card Sweep', kind: 'staff', checkMethod: 'code', answer: 'THE GAME IS AFOOT', reward: 400, description: 'Six cards each carry one word. Find all six and type the sentence they make, in order of the numbers on the cards.' },
  { title: 'Front Office Riddle', kind: 'individual', checkMethod: 'code', answer: 'STAPLER', reward: 150, description: 'Ask the front office for the riddle of the day (before school or after school only). Type the answer.' },
  // Kindness missions (Ghosts can do these too)
  { title: 'Thank a Custodian', kind: 'kindness', checkMethod: 'manual', reward: 150, description: 'Write a thank-you note to someone on the custodial or facilities team and give it to them. Tell the Game Master who (first name only).' },
  { title: 'Cafeteria Shout-out', kind: 'kindness', checkMethod: 'manual', reward: 150, description: 'Thank someone on the food service team in person and tell the Game Master one thing you learned about them.' },
  { title: 'Cross the Hall', kind: 'kindness', checkMethod: 'manual', reward: 150, description: 'Leave a kind sticky note for a colleague in another department. No names needed in your check-in.' },
  { title: 'New Teacher Welcome', kind: 'kindness', checkMethod: 'manual', reward: 200, description: 'Invite a first or second year teacher to sit with you at lunch this week.', awardsShield: true },
  { title: 'Coffee Run', kind: 'kindness', checkMethod: 'manual', reward: 150, description: 'Make or bring a coffee or tea for someone with morning duty. Free options count.' },
  // Trivia (quiz answers are graded automatically)
  { title: 'School History One', kind: 'individual', checkMethod: 'quiz', answer: 'EDIT ME', reward: 100, description: 'What year did our school open? (Game Master: set the answer before opening.)' },
  { title: 'School History Two', kind: 'individual', checkMethod: 'quiz', answer: 'EDIT ME', reward: 100, description: 'What was our mascot named before it was changed, or who was our first principal? (Game Master: pick one and set the answer.)' },
  { title: 'Staff Fun Fact', kind: 'individual', checkMethod: 'quiz', answer: 'EDIT ME', reward: 100, description: 'Which staff member once (fun fact from a volunteer)? Type their first name. (Game Master: set this.)' },
  { title: 'Bell Schedule Sprint', kind: 'individual', checkMethod: 'quiz', answer: 'EDIT ME', reward: 100, description: 'How many minutes long is our longest passing period? Numbers only.' },
  { title: 'Lunch Line Logic', kind: 'individual', checkMethod: 'quiz', answer: 'EDIT ME', reward: 100, description: 'How many lunch periods does our campus run? Numbers only.' },
  // Cross-department pairs (Game Master announces the pairs)
  { title: 'Three in Common', kind: 'pair', checkMethod: 'manual', reward: 200, description: 'Meet your assigned partner from another department and find three things you have in common. Both of you send the same three things.' },
  { title: 'Swap a Tip', kind: 'pair', checkMethod: 'manual', reward: 200, description: 'Trade one teaching or work tip with your partner. Each of you sends the tip you received.' },
  { title: 'Walk and Talk', kind: 'pair', checkMethod: 'manual', reward: 150, description: 'Take a five-minute walk with your partner after school. Send one sentence about it.' },
  // Split-clue puzzles (where the Traitors can quietly sabotage)
  { title: 'The Broken Map', kind: 'puzzle', checkMethod: 'code', answer: 'GYM STOREROOM|GYM STORE ROOM', reward: 400, description: 'Four players in four departments each got one quarter of a map by notice. Meet, put it together and type the place it points to.', awardsShield: true },
  { title: 'Four Letters', kind: 'puzzle', checkMethod: 'code', answer: 'TRUST', reward: 400, description: 'Five players each hold one letter. Find each other, put the letters in order and type the word.' },
  { title: 'The Cipher', kind: 'puzzle', checkMethod: 'code', answer: 'MEET AT NOON', reward: 450, description: 'One player has the cipher key, another has the message, a third has the hint. Work it out together.' },
  { title: 'Numbers Station', kind: 'puzzle', checkMethod: 'code', answer: '4817', reward: 400, description: 'Four players each got one digit and a clue to its place. Type the four-digit number.' },
  // Whole staff
  { title: 'Spirit Day', kind: 'staff', checkMethod: 'manual', reward: 300, description: 'Wear school colors on Friday. Check in with one word: your color.' },
  { title: 'Faculty Meeting Bingo', kind: 'staff', checkMethod: 'manual', reward: 200, description: 'Grab a bingo card from the Game Master before the faculty meeting and mark it quietly. Never during class time.' },
];

// The one-week plan: five school days, one roundtable a day, the Final
// Roundtable on Friday. Each day mixes kinds so everyone has something to do
// before school, at lunch and after school. Missions with a later lastDay stay
// open for several days. Shields come from New Teacher Welcome (all week), The
// Broken Map (Tuesday) and Lounge Makeover (Wednesday to Friday), so a Shield is
// in reach before most nights. Faculty Meeting Bingo is left out: open it by hand
// on the day of your faculty meeting.
export const ONE_WEEK_PLAN = [
  // Monday: learn the game, meet people
  { day: 1, title: 'Lounge Clue' },
  { day: 1, title: 'Copy Room Clue' },
  { day: 1, title: 'Department Haiku' },
  { day: 1, title: 'School History One' },
  { day: 1, lastDay: 2, title: 'Three in Common' },
  { day: 1, lastDay: 2, title: 'Thank a Custodian' },
  { day: 1, lastDay: 5, title: 'New Teacher Welcome' },
  { day: 1, lastDay: 5, title: 'Six Card Sweep' },
  // Tuesday: the first split-clue puzzle, where the Traitors can sabotage
  { day: 2, title: 'Mailroom Clue' },
  { day: 2, title: 'Fact Swap' },
  { day: 2, title: 'School History Two' },
  { day: 2, title: 'The Broken Map' },
  { day: 2, lastDay: 3, title: 'Swap a Tip' },
  { day: 2, lastDay: 3, title: 'Cafeteria Shout-out' },
  // Wednesday: the lunch tower build
  { day: 3, title: 'Tower of Power' },
  { day: 3, title: 'Library Clue' },
  { day: 3, title: 'Staff Fun Fact' },
  { day: 3, title: 'Four Letters' },
  { day: 3, lastDay: 4, title: 'Cross the Hall' },
  { day: 3, lastDay: 5, title: 'Lounge Makeover' },
  // Thursday: the hardest puzzle before the last night
  { day: 4, title: 'Front Office Riddle' },
  { day: 4, title: 'Mascot Sketch' },
  { day: 4, title: 'Bell Schedule Sprint' },
  { day: 4, title: 'The Cipher' },
  { day: 4, title: 'Walk and Talk' },
  { day: 4, lastDay: 5, title: 'Coffee Run' },
  // Friday: a light day around the Final Roundtable
  { day: 5, title: 'Spirit Day' },
  { day: 5, title: 'Lunch Line Logic' },
  { day: 5, title: 'Numbers Station' },
];
