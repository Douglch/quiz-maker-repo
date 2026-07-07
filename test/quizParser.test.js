// Tests for js/quizParser.js — run with:  node --test test/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const QuizParser = require('../js/quizParser.js');

// ---------------------------------------------------------- classic format

test('classic format: numbered questions, explanations, multi-answer', () => {
  const { questions, skipped } = QuizParser.parse([
    '1. What does the -r flag do?',
    'A. Recursive',
    'B. Reverse',
    'C. Read-only',
    'Answer: A',
    'Explanation: r stands for recursive.',
    'It applies to directories.',
    '2. Pick two colors',
    'A. red',
    'B. blue',
    'C. code',
    'Answer: A,C',
    'trailing explanation without a marker',
  ].join('\n'));

  assert.equal(skipped.length, 0);
  assert.equal(questions.length, 2);

  assert.equal(questions[0].text, 'What does the -r flag do?');
  assert.deepEqual(questions[0].answer, ['A']);
  assert.equal(questions[0].multiple, false);
  assert.equal(questions[0].explanation, 'r stands for recursive.\nIt applies to directories.');

  assert.deepEqual(questions[1].answer, ['A', 'C']);
  assert.equal(questions[1].multiple, true);
  assert.equal(questions[1].explanation, 'trailing explanation without a marker');
});

test('classic format: multi-line questions and options', () => {
  const { questions } = QuizParser.parse([
    '3. A question that spans',
    'two lines?',
    'A. option that also',
    'spans two lines',
    'B. short one',
    'Answer: B',
  ].join('\n'));

  assert.equal(questions.length, 1);
  assert.equal(questions[0].text, 'A question that spans\ntwo lines?');
  assert.equal(questions[0].options[0].text, 'option that also\nspans two lines');
});

test('classic format: numbered list inside a question does not split it (lower numbers)', () => {
  const { questions } = QuizParser.parse([
    '5. Follow these steps:',
    '1. Create a bucket',
    '2. Enable versioning',
    'Which is correct?',
    'A. yes',
    'B. no',
    'Answer: A',
  ].join('\n'));

  assert.equal(questions.length, 1);
  assert.match(questions[0].text, /Create a bucket/);
});

test('repeated page footers are stripped as boilerplate', () => {
  const footer = 'BRAINDUMP BANNER contact vendor123';
  const { questions } = QuizParser.parse([
    footer,
    '1. Question one?',
    footer,
    'A. yes',
    'B. no',
    footer,
    'Answer: B',
    footer,
  ].join('\n'));

  assert.equal(questions.length, 1);
  assert.equal(questions[0].text, 'Question one?');
  assert.equal(questions[0].explanation, null);
});

// ------------------------------------------------------ ExamTopics format

// Condensed from a real ExamTopics-style AWS SAA-C03 dump export.
const EXAMTOPICS = `
2/926
Question #1 Topic 1
A company collects data for temperature, humidity, and atmospheric pressure in cities across multiple continents. The average volume of data
that the company collects from each site daily is 500 GB.
Which solution meets these requirements?
A. Turn on S3 Transfer Acceleration on the destination S3 bucket. Use multipart uploads to directly upload site data to the destination S3
bucket.
B. Upload the data from each site to an S3 bucket in the closest Region. Use S3 Cross-Region Replication to copy objects to the destination S3
bucket.
C. Schedule AWS Snowball Edge Storage Optimized device jobs daily to transfer data from each site to the closest Region.
D. Upload the data from each site to an Amazon EC2 instance in the closest Region. Store the data in an Amazon Elastic Block Store volume.
Correct Answer: A
Community vote distribution
A (98%)
austin1167bio Highly Voted 1 month ago
Selected Answer: A
A. S3 Transfer Acceleration will do the required job
A is valid answer jpeg.ly/AWSCertifiedSolutionsArchitectAssociate
upvoted 70 times
BoboChow 1 year, 9 months ago
I thought S3 Transfer Acceleration is based on Cross Region Repilication, I made a mistake.
upvoted 1 times
Realdumpscollection_com_web 2 weeks, 1 day ago
Selected Answer: A
A. Turn on S3 Transfer Acceleration on the destination S3 bucket.
B. Upload the data from each site to an S3 bucket in the closest Region.
Answer: C
upvoted 2 times
3/926
Question #2 Topic 1
A company needs the ability to analyze the log files of its proprietary application. The logs are stored in JSON format in an Amazon S3 bucket.
What should the solutions architect do with the LEAST amount of operational overhead?
A. Use Amazon Redshift to load all the content into one place and run the SQL queries as needed.
B. Use Amazon CloudWatch Logs to store the logs. Run SQL queries as needed from the Amazon CloudWatch console.
C. Use Amazon Athena directly with Amazon S3 to run the queries as needed.
D. Use AWS Glue to catalog the logs. Use a transient Apache Spark cluster on Amazon EMR to run the SQL queries as needed.
Correct Answer: C
airraid2010 Highly Voted 1 year, 9 months ago
Answer: C
https://docs.aws.amazon.com/athena/latest/ug/what-is.html
upvoted 57 times
Question #3 Topic 1
HOTSPOT -
Select the appropriate services from the following diagram.
Correct Answer:
some diagram description here
Question #4 Topic 1
A solutions architect must design a solution. Steps to configure:
1. Create a bucket
2. Enable versioning
Which combination of steps should the solutions architect take? (Choose two.)
A. Create an S3 bucket with versioning enabled Most Voted
B. Use the most recent AMI for the launch template
C. Enable S3 Cross-Region Replication
D. Take EBS snapshots every hour
Correct Answer: AC
Community vote distribution
AC (72%) Other
D2w Highly Voted 1 year, 9 months ago
Selected Answer: AC
upvoted 5 times
`;

test('ExamTopics: questions parse, discussion noise is discarded', () => {
  const { questions, skipped } = QuizParser.parse(EXAMTOPICS);

  assert.equal(questions.length, 3, 'Q1, Q2, Q4 parse');
  assert.equal(skipped.length, 1, 'the HOTSPOT item is skipped');
  assert.equal(skipped[0].number, '3');

  const [q1, q2, q4] = questions;

  // Q1: 4 options, comments quoting options/answers must not leak anywhere.
  assert.equal(q1.number, '1');
  assert.equal(q1.options.length, 4);
  assert.deepEqual(q1.answer, ['A'], 'the "Answer: C" quote in a comment must not override the key');
  assert.equal(q1.explanation, null);
  assert.doesNotMatch(q1.text, /Transfer Acceleration will do/);
  for (const o of q1.options) {
    assert.doesNotMatch(o.text, /upvoted|jpeg\.ly|made a mistake/);
  }

  // Q2: bare "Answer: C" inside the discussion is ignored.
  assert.deepEqual(q2.answer, ['C']);
  assert.equal(q2.explanation, null);

  // Q4: run-together multi-answer key.
  assert.deepEqual(q4.answer, ['A', 'C']);
  assert.equal(q4.multiple, true);
});

test('ExamTopics: numbered lists inside a question do not split it (header style lock)', () => {
  const { questions } = QuizParser.parse(EXAMTOPICS);
  const q4 = questions[2];
  assert.match(q4.text, /1\. Create a bucket/);
  assert.match(q4.text, /2\. Enable versioning/);
});

test('ExamTopics: inline "Most Voted" badge is stripped from option text', () => {
  const { questions } = QuizParser.parse(EXAMTOPICS);
  const q4 = questions[2];
  assert.equal(q4.options[0].text, 'Create an S3 bucket with versioning enabled');
});

test('ExamTopics: prose "most recent" in an option is not mistaken for a forum badge', () => {
  const { questions } = QuizParser.parse(EXAMTOPICS);
  const q4 = questions[2];
  assert.equal(q4.options[1].text, 'Use the most recent AMI for the launch template');
});

test('ExamTopics: numbering may restart when the topic changes', () => {
  const { questions } = QuizParser.parse([
    'Question #2 Topic 1',
    'First question?',
    'A. yes',
    'B. no',
    'Correct Answer: A',
    'Question #1 Topic 2',
    'Second question, numbering restarted?',
    'A. yes',
    'B. no',
    'Correct Answer: B',
  ].join('\n'));

  assert.equal(questions.length, 2);
  assert.deepEqual(questions.map((q) => q.answer[0]), ['A', 'B']);
});

test('ExamTopics: prefixed answer key rescues a question whose comments start early', () => {
  const { questions } = QuizParser.parse([
    'Question #7 Topic 1',
    'Question text here?',
    'A. one',
    'B. two',
    'someuser Highly Voted 1 month ago',
    'B is clearly right, see the docs',
    'upvoted 3 times',
    'Correct Answer: B',
    'anotheruser 2 weeks ago',
    'Answer: A',
    'upvoted 1 times',
  ].join('\n'));

  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].answer, ['B'], 'prefixed key accepted, bare comment quote ignored');
  assert.doesNotMatch(questions[0].options[1].text, /clearly right/);
});

test('question text containing "3 months ago" is not treated as a comment', () => {
  const { questions } = QuizParser.parse([
    '1. A company deployed an application 3 months ago',
    'and now needs to scale it. What should it do?',
    'A. scale up',
    'B. scale out',
    'Answer: B',
  ].join('\n'));

  assert.equal(questions.length, 1);
  assert.match(questions[0].text, /3 months ago/);
});

// -------------------------------------------------------------- answer key

test('answer keys: separated, run-together, deduplicated', () => {
  const parseOne = (answerLine) => QuizParser.parse([
    '1. Q?', 'A. a', 'B. b', 'C. c', 'D. d', answerLine,
  ].join('\n')).questions[0];

  assert.deepEqual(parseOne('Answer: A, C').answer, ['A', 'C']);
  assert.deepEqual(parseOne('Correct Answer: BD').answer, ['B', 'D']);
  assert.deepEqual(parseOne('Suggested Answer: D').answer, ['D']);
  assert.deepEqual(parseOne('Answer: A,A').answer, ['A'], 'duplicate letters collapse');
  assert.equal(parseOne('Answer: A,A').multiple, false);
});

test('answer keys: lowercase prose is not mistaken for a run-together key', () => {
  const { questions } = QuizParser.parse([
    '1. Q?',
    'A. a',
    'B. b',
    'Answer: added',
    'Answer: B',
  ].join('\n'));

  assert.equal(questions.length, 1);
  assert.deepEqual(questions[0].answer, ['B']);
});

test('answer key referencing missing options is reported as skipped', () => {
  const { questions, skipped } = QuizParser.parse([
    '1. Q?', 'A. a', 'B. b', 'Answer: F',
  ].join('\n'));

  assert.equal(questions.length, 0);
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /Answer key referenced/);
});

// ------------------------------------------------------------- edge cases

test('empty and garbage input parse to nothing without crashing', () => {
  assert.deepEqual(QuizParser.parse(''), { questions: [], skipped: [] });
  assert.deepEqual(QuizParser.parse('just some\nrandom text\nno questions'),
    { questions: [], skipped: [] });
});

test('vote bars never swallow a lone option-letter line', () => {
  // "D" alone must not be treated as a vote bar (bars require "(NN%)").
  const { questions } = QuizParser.parse([
    '1. Q?',
    'A. first',
    'B. second half on next line:',
    'D',
    'Answer: A',
  ].join('\n'));

  assert.equal(questions.length, 1);
  assert.equal(questions[0].options[1].text, 'second half on next line:\nD');
});
