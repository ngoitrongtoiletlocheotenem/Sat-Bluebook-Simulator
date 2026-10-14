import type { Knex } from 'knex';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { DOMAINS, SKILLS } from './taxonomy.js';
import { fullBlueprint, shuffle } from './engines.js';
import { encode, now } from './db.js';
import { questionSchema, type QuestionContent } from './validation.js';

function choices(correct: string, wrong: string[], explanation: string, seed: string) {
  const options = shuffle(
    [{ text: correct, right: true }, ...wrong.map((text) => ({ text, right: false }))],
    seed,
  );
  return {
    choices: options.map((o, i) => ({
      id: 'ABCD'[i]!,
      text: o.text,
      rationale: o.right
        ? explanation
        : `This choice does not follow the evidence or calculation in the explanation. ${explanation}`,
    })),
    correctAnswer: 'ABCD'[options.findIndex((o) => o.right)]!,
  };
}
function mathItem(
  skill: string,
  n: number,
): { stem: string; answer: number; explanation: string; images?: string[] } {
  const a = 2 + (n % 7),
    b = 5 + n,
    x = 3 + (n % 11);
  switch (skill) {
    case 'Linear equations in one variable':
      return {
        stem: `If $${a}x + ${b} = ${a * x + b}$, what is the value of $x$?`,
        answer: x,
        explanation: `Subtract ${b} from both sides, then divide by ${a}: $x=${a * x}/${a}=${x}$.`,
      };
    case 'Linear functions':
      return {
        stem: `A workshop charges a registration fee of ${b} dollars and ${a} dollars for each hour. What is the total cost, in dollars, for ${x} hours?`,
        answer: b + a * x,
        explanation: `The linear cost is $C(h)=${b}+${a}h$. Substituting $h=${x}$ gives $${b + a * x}$.`,
      };
    case 'Linear equations in two variables':
      return {
        stem: `The equation $y=${a}x+${b}$ models a relationship. What is $y$ when $x=${x}$?`,
        answer: a * x + b,
        explanation: `Substitute ${x} for $x$: $y=${a}(${x})+${b}=${a * x + b}$.`,
      };
    case 'Systems of two linear equations in two variables':
      return {
        stem: `The system $x+y=${x + b}$ and $x-y=${x - b}$ has one solution. What is $x$?`,
        answer: x,
        explanation: `Add the equations to eliminate $y$: $2x=${2 * x}$, so $x=${x}$.`,
      };
    case 'Linear inequalities in one or two variables':
      return {
        stem: `What is the greatest integer value of $x$ satisfying $${a}x+${b}<${a * x + b}$?`,
        answer: x - 1,
        explanation: `Subtract ${b} and divide by positive ${a} to get $x<${x}$. The greatest integer is ${x - 1}.`,
      };
    case 'Equivalent expressions':
      return {
        stem: `The expression $${a}(x+${b})-${a}x$ is equivalent to which constant?`,
        answer: a * b,
        explanation: `Distribute ${a}: $${a}x+${a * b}-${a}x=${a * b}$.`,
      };
    case 'Nonlinear equations in one variable and systems of equations in two variables':
      return {
        stem: `What is the positive solution of $x^2=${x * x}$?`,
        answer: x,
        explanation: `Taking square roots gives $x=\pm ${x}$. The positive solution is ${x}.`,
      };
    case 'Nonlinear functions':
      return {
        stem: `For $f(t)=(t-${a})^2+${b}$, what is the minimum value of $f$?`,
        answer: b,
        explanation: `A square is nonnegative. When $t=${a}$, the square is zero, so the minimum is ${b}.`,
      };
    case 'Ratios, rates, proportional relationships, and units':
      return {
        stem: `A printer produces ${a * x} labels in ${a} minutes at a constant rate. How many labels does it produce in ${b} minutes?`,
        answer: x * b,
        explanation: `The rate is $${a * x}/${a}=${x}$ labels per minute. Multiply by ${b} minutes to obtain ${x * b}.`,
      };
    case 'Percentages':
      return {
        stem: `A notebook costs ${b * 10} dollars. Its price is reduced by 20%. What is its sale price, in dollars?`,
        answer: b * 8,
        explanation: `After a 20% reduction, 80% remains: $0.80(${b * 10})=${b * 8}$.`,
      };
    case 'One-variable data: distributions and measures of center and spread':
      return {
        stem: `The values in a data set are ${b}, ${b + 2}, ${b + 4}, ${b + 6}, and ${b + 8}. What is the median?`,
        answer: b + 4,
        explanation: `The data are ordered. The third of five values, ${b + 4}, is the median.`,
      };
    case 'Two-variable data: models and scatterplots':
      return {
        stem: `A linear model predicts a seedling's height, in centimeters, after $t$ weeks as $h=${a}t+${b}$. What height does it predict at ${x} weeks?`,
        answer: a * x + b,
        explanation: `Evaluate the model at $t=${x}$: $h=${a}(${x})+${b}=${a * x + b}$.`,
      };
    case 'Probability and conditional probability':
      return {
        stem: `A box contains ${a} blue counters and ${a} green counters. A counter is chosen at random. What is the probability that it is blue?`,
        answer: 0.5,
        explanation: `There are ${a} favorable outcomes among ${2 * a} equally likely outcomes, so $P(blue)=${a}/${2 * a}=1/2$.`,
      };
    case 'Inference from sample statistics and margin of error':
      return {
        stem: `A poll estimates support at ${50 + (n % 20)}% with a margin of error of 3 percentage points. What is the upper end, as a percentage, of the reported interval?`,
        answer: 53 + (n % 20),
        explanation: `Add the margin of error to the estimate: $${50 + (n % 20)}+3=${53 + (n % 20)}$ percent.`,
      };
    case 'Evaluating statistical claims: observational studies and experiments':
      return {
        stem: `A researcher randomly assigns ${2 * b} volunteers equally to two treatments. How many volunteers receive each treatment?`,
        answer: b,
        explanation: `Equal assignment divides ${2 * b} volunteers into two groups: $${2 * b}/2=${b}$. Random assignment supports a causal comparison for this experiment.`,
      };
    case 'Area and volume':
      return {
        stem: `A rectangular garden has length ${b} meters and width ${a} meters. What is its area in square meters?`,
        answer: a * b,
        explanation: `Rectangle area equals length times width: $A=${b}(${a})=${a * b}$ square meters.`,
      };
    case 'Lines, angles, and triangles':
      return {
        stem: `Two angles in a triangle measure ${35 + (n % 20)}° and ${65 + (n % 15)}°. What is the measure, in degrees, of the third angle?`,
        answer: 180 - (35 + (n % 20)) - (65 + (n % 15)),
        explanation: `A triangle's interior angles sum to 180°. Subtract the two given angles: $180-${35 + (n % 20)}-${65 + (n % 15)}=${180 - (35 + (n % 20)) - (65 + (n % 15))}$.`,
      };
    case 'Right triangles and trigonometry':
      return {
        stem: `A right triangle has leg lengths ${3 * a} and ${4 * a}. What is its hypotenuse length?`,
        answer: 5 * a,
        explanation: `By the Pythagorean theorem, $c=\sqrt{(${3 * a})^2+(${4 * a})^2}=${5 * a}$.`,
      };
    default:
      return {
        stem: `A circle has diameter ${2 * a}. What is its radius?`,
        answer: a,
        explanation: `The radius is half the diameter: $r=${2 * a}/2=${a}$.`,
      };
  }
}
function rwItem(skill: string, n: number) {
  const subject = [
    'a coastal garden',
    'an urban library',
    'a community telescope project',
    'a mountain trail',
    'a neighborhood seed exchange',
    'a river restoration project',
  ][n % 6]!;
  const researcher = ['Mira', 'Jonas', 'Lena', 'Arun', 'Tessa', 'Niko'][Math.floor(n / 6) % 6]!;
  switch (skill) {
    case 'Central Ideas and Details':
      return {
        passage: `${researcher} studied ${subject}. At first, only a few residents participated. After organizers held weekend demonstrations, participation increased and residents began organizing events themselves.`,
        stem: 'Which choice best states the main idea of the text?',
        correct: 'Public demonstrations helped a community project attract participation.',
        wrong: [
          'The project ended because residents lost interest.',
          'Only professional researchers can organize public events.',
          'The demonstrations replaced all earlier activities.',
        ],
        explanation:
          'The passage connects demonstrations with increasing participation and resident leadership.',
      };
    case 'Textual Evidence':
      return {
        passage: `While researching ${subject}, ${researcher} noticed that visitors stayed longer when guides asked open-ended questions. Visitors often described their own experiences before exploring the exhibits again.`,
        stem: 'Which detail most directly supports the claim that questions encouraged visitors to connect with the exhibits?',
        correct: 'Visitors described their own experiences before exploring again.',
        wrong: [
          'The researcher studied a community project.',
          'The guides were available to visitors.',
          'Some exhibits could be explored more than once.',
        ],
        explanation:
          'The visitors shared personal experiences, directly showing a connection between the exhibits and their lives.',
      };
    case 'Quantitative Evidence':
      return {
        passage: `${researcher} counted attendance at ${subject}. In week 1, attendance was ${20 + n}; in week 2, it was ${30 + n}; and in week 3, it was ${45 + n}.`,
        stem: 'Which claim is best supported by the attendance data?',
        correct: 'Attendance increased in each successive week.',
        wrong: [
          'Attendance was identical in weeks 1 and 3.',
          'Attendance decreased after the first week.',
          'Attendance doubled between every pair of weeks.',
        ],
        explanation: `The three counts, ${20 + n}, ${30 + n}, and ${45 + n}, increase from week to week; they do not double at each step.`,
      };
    case 'Inferences':
      return {
        passage: `For ${subject}, ${researcher} prepared written instructions. Several participants asked for a live demonstration instead. After seeing the demonstration, those participants completed the task independently.`,
        stem: 'Which inference is best supported by the text?',
        correct: 'Some participants benefited from seeing the procedure performed.',
        wrong: [
          'Written instructions are never useful.',
          'The task required years of training.',
          'The participants could not work independently.',
        ],
        explanation:
          'The participants completed the task independently after seeing it demonstrated, indicating that the demonstration helped them.',
      };
    case 'Words in Context':
      return {
        passage: `The volunteer team maintained ${subject} for several years. ${researcher} called their efforts sustained because the work continued through changing seasons and leadership.`,
        stem: 'As used in the text, “sustained” most nearly means',
        correct: 'continued over time.',
        wrong: ['unexpectedly interrupted.', 'financially expensive.', 'disputed by experts.'],
        explanation:
          'The explanation that work continued for years gives “sustained” the meaning of continued over time.',
      };
    case 'Text Structure and Purpose':
      return {
        passage: `Some visitors assume ${subject} requires expensive equipment. ${researcher}, however, describes how volunteers completed important tasks using simple shared tools.`,
        stem: 'What is the main purpose of the second sentence?',
        correct: 'To challenge an assumption introduced in the first sentence.',
        wrong: [
          'To repeat the assumption without adding information.',
          'To introduce an unrelated historical event.',
          'To criticize visitors for asking questions.',
        ],
        explanation:
          'The contrast introduced by “however” presents simple shared tools as evidence against the assumption that costly equipment is required.',
      };
    case 'Cross-Text Connections':
      return {
        passage: `Text 1\n${researcher} argues that ${subject} succeeds primarily because of its careful initial plan.\n\nText 2\nA second organizer agrees that planning matters but emphasizes regular feedback from participants, which allows the project to adapt.`,
        stem: 'How would the organizer in Text 2 most likely respond to Text 1?',
        correct:
          'By agreeing that planning matters while noting that ongoing feedback also contributes to success.',
        wrong: [
          'By claiming all planning is harmful.',
          'By agreeing that no changes should occur after planning.',
          'By denying that participants provide useful information.',
        ],
        explanation:
          'Text 2 explicitly agrees that planning matters and adds the importance of feedback and adaptation.',
      };
    case 'Rhetorical Synthesis':
      return {
        passage: `A student has taken these notes:\n• ${researcher} helped organize ${subject}.\n• The project offered free workshops.\n• Workshop attendance grew from ${20 + n} to ${45 + n}.\n• Volunteers added two sessions to meet demand.`,
        stem: 'The student wants to emphasize the response to increased attendance. Which choice best uses the notes?',
        correct: 'As workshop attendance grew, volunteers added two sessions to meet demand.',
        wrong: [
          `${researcher} helped organize a community project.`,
          'The project offered workshops at no cost.',
          'The workshops initially drew a small group.',
        ],
        explanation:
          'The correct sentence connects the growth in attendance to the concrete response of adding sessions, meeting the stated goal.',
      };
    case 'Transitions':
      return {
        passage: `The volunteers planned to complete the outdoor work at ${subject} on Saturday. Heavy rain made outdoor work impossible. _____ they moved the session indoors to prepare materials.`,
        stem: 'Which choice completes the text with the most logical transition?',
        correct: 'Therefore,',
        wrong: ['For example,', 'Similarly,', 'Nevertheless,'],
        explanation:
          'Moving indoors is a result of rain preventing outdoor work. “Therefore” signals that cause-and-effect relationship.',
      };
    case 'Boundaries':
      return {
        passage: `While reviewing a draft about ${subject}, a student writes: “The project welcomed new volunteers _____ its organizers offered training each month.”`,
        stem: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
        correct: '; ',
        wrong: [', ', '(no punctuation)', ' and, '],
        explanation:
          'Both parts are independent clauses. A semicolon correctly joins them; a comma alone creates a comma splice, and no punctuation creates a run-on.',
      };
    default:
      return {
        passage: `The collection of tools used at ${subject} _____ stored in a locked cabinet every evening.`,
        stem: 'Which choice completes the text so that it conforms to the conventions of Standard English?',
        correct: 'is',
        wrong: ['are', 'were', 'have been'],
        explanation:
          'The subject is the singular noun “collection,” so the singular verb “is” agrees with it. The plural noun “tools” belongs to a modifying phrase.',
      };
  }
}
export function originalQuestions(): QuestionContent[] {
  return DOMAINS.flatMap((domain) =>
    Array.from({ length: 44 }, (_, i) => {
      const skill = SKILLS.filter((s) => s.domainId === domain.id)[i % domain.skills.length]!;
      const common = {
        publicId: `ORIGINAL-${domain.id}-${String(i + 1).padStart(3, '0')}`,
        section: domain.section,
        domainId: domain.id,
        skillId: skill.id,
        difficulty: ['easy', 'medium', 'hard'][i % 3],
        source: 'Original educational demonstration',
        license: 'CC0-1.0. Original, generated educational examples; not College Board questions.',
        author: 'Studyline authors',
        tags: ['original', 'sample'],
        status: 'published',
        calculator: 'allowed',
        passage: '',
        hint: 'Identify the relevant evidence or relationship before choosing an answer.',
        strategy: 'Check that the answer addresses exactly what is asked.',
      };
      if (domain.section === 'rw') {
        const item = rwItem(skill.name, i);
        return questionSchema.parse({
          ...common,
          type: 'mcq',
          passage: item.passage,
          stem: item.stem,
          explanation: item.explanation,
          ...choices(item.correct, item.wrong, item.explanation, common.publicId),
        });
      }
      const item = mathItem(skill.name, i);
      const spr = i % 4 === 0;
      const q = {
        ...common,
        type: spr ? 'spr' : 'mcq',
        stem: item.stem,
        explanation: item.explanation,
        ...(spr
          ? { acceptedAnswers: [String(item.answer)] }
          : choices(
              String(item.answer),
              [
                String(item.answer + 1),
                String(item.answer + 3),
                String(item.answer === 0.5 ? 0.25 : item.answer - 1),
              ],
              item.explanation,
              common.publicId,
            )),
      };
      // Original accessible data figure: this item actually asks about the figure.
      if (domain.id === 'math-data' && i === 3)
        Object.assign(q, {
          stem: 'The chart shows 12 oak, 18 pine, and 24 maple seedlings in a nursery. What fraction of the seedlings are pine?',
          explanation: 'There are $12+18+24=54$ seedlings. Pine accounts for $18/54=1/3$.',
          images: ['/assets/seedling-chart.svg'],
          type: 'spr',
          acceptedAnswers: ['1/3'],
          choices: [],
          correctAnswer: '',
        });
      return questionSchema.parse(q);
    }),
  );
}
export async function seed(db: Knex) {
  await db.transaction(async (trx) => {
    for (let i = 0; i < DOMAINS.length; i++) {
      const d = DOMAINS[i]!;
      await trx('domains')
        .insert({
          id: d.id,
          section: d.section,
          name: d.name,
          percentage: d.percentage,
          question_range: d.questionRange,
          position: i,
        })
        .onConflict('id')
        .ignore();
    }
    for (const s of SKILLS)
      await trx('skills').insert({ id: s.id, domain_id: s.domainId, name: s.name }).onConflict('id').ignore();
    for (const q of originalQuestions()) {
      const existing = await trx('questions').where({ public_id: q.publicId }).first();
      if (existing) {
        // Apply editorial fixes to untouched original examples while preserving
        // old versions used by attempts. Questions edited by users are retained.
        if (existing.version === 1) {
          const old = await trx('question_versions').where({ question_id: existing.id, version: 1 }).first();
          if (old && old.content !== encode(q)) {
            await trx('question_versions').insert({
              id: randomUUID(),
              question_id: existing.id,
              version: 2,
              content: encode(q),
              created_at: now(),
            });
            await trx('questions').where({ id: existing.id }).update({ version: 2, updated_at: now() });
          }
        }
        continue;
      }
      const id = randomUUID(),
        timestamp = now();
      await trx('questions').insert({
        id,
        public_id: q.publicId,
        section: q.section,
        domain_id: q.domainId,
        skill_id: q.skillId,
        difficulty: q.difficulty,
        status: q.status,
        version: 1,
        created_at: timestamp,
        updated_at: timestamp,
      });
      await trx('question_versions').insert({
        id: randomUUID(),
        question_id: id,
        version: 1,
        content: encode(q),
        created_at: timestamp,
      });
    }
    const b = fullBlueprint();
    await trx('blueprints')
      .insert({
        id: b.id,
        name: b.title,
        published: true,
        version: 1,
        config: encode(b),
        created_at: now(),
        updated_at: now(),
      })
      .onConflict('id')
      .ignore();
  });
  mkdirSync('public/assets', { recursive: true });
  writeFileSync(
    'public/assets/seedling-chart.svg',
    '<svg xmlns="http://www.w3.org/2000/svg" width="460" height="250" viewBox="0 0 460 250" role="img" aria-label="Seedlings: Oak 12, Pine 18, Maple 24"><rect width="460" height="250" fill="white"/><text x="230" y="24" text-anchor="middle" font-family="Arial" font-size="17">Seedlings in the nursery</text><path d="M60 45V200H430" fill="none" stroke="#172c42" stroke-width="2"/><g fill="#305879"><rect x="95" y="128" width="65" height="72"/><rect x="205" y="92" width="65" height="108"/><rect x="315" y="56" width="65" height="144"/></g><g font-family="Arial" text-anchor="middle" font-size="15"><text x="127" y="120">12</text><text x="237" y="84">18</text><text x="347" y="48">24</text><text x="127" y="224">Oak</text><text x="237" y="224">Pine</text><text x="347" y="224">Maple</text></g></svg>',
  );
}
