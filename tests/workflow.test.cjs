// Run with: node tests/workflow.test.cjs
// No external packages. Check graph analysis, conditional questions, and card gates.
// The small DOM stub does not check browser appearance or layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    innerHTML: '', textContent: '', value: '', style: {}, classList: { toggle() {} },
    addEventListener() {}, querySelector(selector) { return element(id + selector); },
  });
  return elements.get(id);
}
const context = vm.createContext({
  document: { getElementById: element, querySelector: element, addEventListener() {} },
  window: { addEventListener() {}, scrollTo() {} },
  requestAnimationFrame() {}, setTimeout() {}, clearTimeout() {},
});
vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
const run = code => vm.runInContext(code, context);
const value = code => JSON.parse(run(`JSON.stringify(${code})`));
const questionKeys = () => value('getQuestions().map(q => q.key)');
const cardIds = () => value('computeStrategies().map(card => card.id)');
let count = 0;
let failures = 0;
function test(name, fn) {
  try { fn(); count++; console.log('PASS', name); }
  catch (error) { failures++; console.error('FAIL', name, '\n', error); }
}
function graph(types, edges) {
  const g = {
    nodes: types.map((type, i) => ({ id: i + 1, name: 'N' + (i + 1), type })),
    edges: edges.map(([from, to]) => ({ from, to })),
  };
  assert.equal(run(`applyGraph(${JSON.stringify(g)})`), null);
  run('S.step = 0; renderAll()');
}
function shiftedCause() {
  graph(['shift', 'observed', 'target'], [[1, 2], [2, 3]]);
}
function answer(key, val) {
  assert.ok(questionKeys().includes(key), `Question ${key} must be available`);
  run(`selectAnswer(${JSON.stringify(key)}, ${JSON.stringify(val)})`);
}

test('Empty graph cannot skip validation', () => {
  run('showStrategies()');
  assert.equal(run('S.step'), 0);
  assert.match(element('nav-err').textContent, /at least 2/);
  run('startDetails()');
  assert.equal(run('S.step'), 0);
});
test('A shifted cause supports stable conditional prediction and graph-only cards', () => {
  shiftedCause();
  assert.equal(run('separatesShifts([2])'), true);
  assert.deepEqual(cardIds(), ['stable-features']);
  assert.deepEqual(value('graphAnalysis().weightingPredictors.map(n => n.id)'), [2]);
});
test('Conditioning on a collider opens a path to the shift', () => {
  graph(['shift', 'observed', 'latent', 'target'], [[1, 2], [3, 2], [3, 4]]);
  assert.equal(run('separatesShifts([])'), true);
  assert.equal(run('separatesShifts([2])'), false);
  assert.deepEqual(cardIds(), []);
});
test('Conditioning on a collider descendant also opens its path', () => {
  graph(['shift', 'latent', 'latent', 'target', 'observed'], [[1, 2], [3, 2], [3, 4], [2, 5]]);
  assert.equal(run('separatesShifts([5])'), false);
});
test('Joint predictor set can block paths neither predictor blocks alone', () => {
  graph(['shift', 'observed', 'observed', 'target'], [[1, 2], [1, 3], [2, 4], [3, 4]]);
  assert.equal(run('separatesShifts([2])'), false);
  assert.equal(run('separatesShifts([3])'), false);
  assert.deepEqual(value('graphAnalysis().predictorSets.map(s => s.map(n => n.id))'), [[2, 3]]);
});
test('Stable but uninformative predictors are dropped', () => {
  // Shift -> N3 <- latent -> N4 <- target: {N3} is stable but independent of the target.
  graph(['shift', 'latent', 'observed', 'observed', 'target'], [[1, 3], [2, 3], [2, 4], [5, 4]]);
  assert.equal(run('separatesShifts([3])'), true);
  assert.deepEqual(value('graphAnalysis().predictorSets.map(s => s.map(n => n.id))'), [[4]]);
});
test('Incomparable maximal stable sets are all shown when their union is unstable', () => {
  graph(['shift', 'latent', 'observed', 'observed', 'observed', 'target'],
    [[1, 3], [3, 4], [6, 4], [2, 3], [2, 5], [6, 5]]);
  assert.equal(run('separatesShifts([3, 4, 5])'), false);
  assert.deepEqual(value('graphAnalysis().predictorSets.map(s => s.map(n => n.id))'), [[3, 4], [5]]);
  run('showStrategies()');
  assert.match(element('step2').innerHTML, /2 alternative sets/);
});
test('At most four predictor sets are shown', () => {
  // Three copies of the two-set graph above give eight maximal stable sets.
  const types = ['shift', 'target'], edges = [];
  for (let b = 3; b < 15; b += 4) {
    types.push('latent', 'observed', 'observed', 'observed');
    edges.push([1, b + 1], [b + 1, b + 2], [2, b + 2], [b, b + 1], [b, b + 3], [2, b + 3]);
  }
  graph(types, edges);
  const sets = value('graphAnalysis().predictorSets.map(s => s.map(n => n.id))');
  assert.equal(sets.length, 4);
  sets.forEach((a, i) => sets.forEach((b, j) => {
    if (i !== j) assert.ok(!a.every(id => b.includes(id)), 'No set may be a subset of another');
  }));
});
test('Five-set test example shows four maximal sets, one per line', () => {
  run('loadExample(3)');
  const sets = value('graphAnalysis().predictorSets.map(s => s.map(n => n.name).join("+"))');
  assert.deepEqual(sets, ['C1+C3+D1+D3', 'C1+C4+D1+D4', 'C2+C4+D2+D4', 'C2+C5+D2+D5']);
  assert.ok(run('separatesShifts(S.nodes.filter(n => ["C3", "C5", "D3", "D5"].includes(n.name)).map(n => n.id))'));
  run('showStrategies()');
  assert.equal((element('step2').innerHTML.match(/<li>/g) || []).length, 4);
});
test('Latent confounding and a target mechanism shift prevent false stability claims', () => {
  graph(['shift', 'latent', 'observed', 'target'], [[1, 2], [2, 3], [2, 4]]);
  assert.equal(run('separatesShifts([3])'), false);
  assert.deepEqual(cardIds(), []);
  graph(['shift', 'target', 'observed'], [[1, 2], [2, 3]]);
  assert.deepEqual(cardIds(), []);
});
test('Affected inputs include descendants through the target but exclude disconnected inputs', () => {
  graph(['shift', 'target', 'observed', 'observed'], [[1, 2], [2, 3], [1, 4]]);
  assert.deepEqual(value('graphAnalysis().shiftedInputs.map(n => n.id)'), [3]);
  assert.ok(questionKeys().includes('role:3'));
  assert.ok(!questionKeys().includes('role:4'));
});
test('No shifts gives no vacuous stability or weighting recommendation', () => {
  graph(['observed', 'target'], [[1, 2]]);
  assert.deepEqual(value('graphAnalysis().shiftedInputs'), []);
  assert.deepEqual(value('graphAnalysis().weightingPredictors'), []);
  assert.deepEqual(cardIds(), []);
  run('showStrategies()');
  assert.match(element('step2').innerHTML, /Add expected shift variables/);
});
test('Bundled examples identify useful observed predictors', () => {
  const expected = ['Smoking', 'Skin Appearance', 'p-tau217'];
  expected.forEach((name, i) => {
    assert.equal(run(`applyGraph(EXAMPLES[${i}].graph)`), null);
    assert.ok(run(`graphAnalysis().predictorSets.flat().some(n => n.name === ${JSON.stringify(name)})`));
    assert.equal(run('graphAnalysis().predictorSets.flat().some(n => n.type !== "observed")'), false);
    assert.deepEqual(cardIds(), ['stable-features']);
  });
});
test('Preliminary route skips questions and Back returns to the graph', () => {
  shiftedCause();
  assert.equal(element('btn-preliminary').hidden, false);
  run('showStrategies()');
  assert.equal(run('S.step'), 2);
  assert.match(element('step2').innerHTML, /Preliminary recommendations/);
  assert.match(element('step2').innerHTML, /strat-resources" hidden/);
  assert.match(element('step2').innerHTML, /startDetails\(\)/);
  assert.doesNotMatch(element('step2').innerHTML, /Feasibility Verdict|Domain adaptation/);
  run('navigate(-1)');
  assert.equal(run('S.step'), 0);
});
test('Optional details open the first unanswered question and return from recommendations', () => {
  shiftedCause();
  answer('trainingEnvironments', 'single');
  run('showStrategies(); startDetails()');
  assert.equal(run('S.step'), 1);
  assert.equal(run('S.questionKey'), 'deploymentData');
  run('showStrategies(); navigate(-1)');
  assert.equal(run('S.step'), 1);
  assert.equal(run('S.questionKey'), 'deploymentData');
});
test('Only three stages remain in the stepper and render targets', () => {
  shiftedCause();
  assert.equal((element('stepper').innerHTML.match(/class="step-tab/g) || []).length, 3);
  assert.doesNotMatch(element('stepper').innerHTML, /Feasibility Analysis|>IV</);
  assert.doesNotMatch(html, /id="step3"/);
});
test('Base questions are shared, and follow-ups wait for parent answers', () => {
  shiftedCause();
  assert.deepEqual(questionKeys(), ['trainingEnvironments', 'deploymentData', 'role:2']);
  answer('trainingEnvironments', 'multiple_identified');
  answer('deploymentData', 'labelled');
  answer('role:2', 'both');
  ['worstGroup', 'localUpdate', 'coverage', 'correction:2', 'augmentation:2'].forEach(key => {
    assert.ok(questionKeys().includes(key));
  });
});
test('Hidden questions and invalid choices cannot set answers', () => {
  shiftedCause();
  run("selectAnswer('worstGroup', 'yes'); selectAnswer('localUpdate', 'yes'); selectAnswer('coverage', 'yes'); selectAnswer('correction:2', 'yes'); selectAnswer('augmentation:2', 'yes'); selectAnswer('role:999', 'cue'); selectAnswer('trainingEnvironments', 'yes'); selectAnswer('deploymentData', 'other')");
  assert.equal(run('S.answers.worstGroup'), null);
  assert.equal(run('S.answers.localUpdate'), null);
  assert.equal(run('S.answers.coverage'), null);
  assert.deepEqual(value('S.answers.corrections'), {});
  assert.deepEqual(value('S.answers.augmentations'), {});
  assert.deepEqual(value('S.answers.inputRoles'), {});
  assert.equal(run('S.answers.trainingEnvironments'), null);
  assert.equal(run('S.answers.deploymentData'), null);
  assert.deepEqual(cardIds(), ['stable-features']);
});
test('Question navigation requires an answer, accepts unknown, and finishes the active branch', () => {
  shiftedCause();
  run('startDetails(); advanceDetailQuestion()');
  assert.equal(run('S.questionKey'), 'trainingEnvironments');
  answer('trainingEnvironments', 'unknown');
  run('advanceDetailQuestion()');
  assert.equal(run('S.questionKey'), 'deploymentData');
  run('retreatDetailQuestion()');
  assert.equal(run('S.questionKey'), 'trainingEnvironments');
  run('advanceDetailQuestion()');
  answer('deploymentData', 'unknown');
  run('advanceDetailQuestion()');
  assert.equal(run('S.questionKey'), 'role:2');
  answer('role:2', 'unknown');
  run('advanceDetailQuestion()');
  assert.equal(run('S.step'), 2);
  assert.deepEqual(cardIds(), ['stable-features']);
  run('navigate(-1)');
  assert.equal(run('S.step'), 1);
  assert.equal(run('S.questionKey'), 'role:2');
});
test('Group DRO needs identified environments and a positive worst-group objective', () => {
  shiftedCause();
  for (const environment of ['single', 'multiple_unknown', 'unknown']) {
    answer('trainingEnvironments', environment);
    assert.ok(!questionKeys().includes('worstGroup'));
    assert.ok(!cardIds().includes('group-dro'));
  }
  answer('trainingEnvironments', 'multiple_identified');
  for (const objective of ['unknown', 'no']) {
    answer('worstGroup', objective);
    assert.ok(!cardIds().includes('group-dro'));
  }
  answer('worstGroup', 'yes');
  assert.ok(cardIds().includes('group-dro'));
  answer('trainingEnvironments', 'single');
  assert.equal(run('S.answers.worstGroup'), null);
  assert.ok(!cardIds().includes('group-dro'));
  answer('trainingEnvironments', 'multiple_identified');
  assert.ok(!cardIds().includes('group-dro'));
});
test('Measurement correction and cue augmentation need a matching role and known procedure', () => {
  shiftedCause();
  answer('role:2', 'measurement');
  assert.ok(questionKeys().includes('correction:2'));
  assert.ok(!questionKeys().includes('augmentation:2'));
  for (const procedure of ['unknown', 'no']) {
    answer('correction:2', procedure);
    assert.ok(!cardIds().includes('measurement-correction'));
  }
  answer('correction:2', 'yes');
  assert.ok(cardIds().includes('measurement-correction'));
  answer('role:2', 'cue');
  assert.equal(run('S.answers.corrections[2] == null'), true);
  assert.ok(!cardIds().includes('measurement-correction'));
  assert.ok(questionKeys().includes('augmentation:2'));
  for (const procedure of ['unknown', 'no']) {
    answer('augmentation:2', procedure);
    assert.ok(!cardIds().includes('cue-augmentation'));
  }
  answer('augmentation:2', 'yes');
  assert.ok(cardIds().includes('cue-augmentation'));
});
test('One input can have both procedures, and changing its role clears both answers', () => {
  shiftedCause();
  answer('role:2', 'both');
  answer('correction:2', 'yes');
  answer('augmentation:2', 'yes');
  assert.ok(cardIds().includes('measurement-correction'));
  assert.ok(cardIds().includes('cue-augmentation'));
  answer('role:2', 'other');
  assert.equal(run('S.answers.corrections[2] == null'), true);
  assert.equal(run('S.answers.augmentations[2] == null'), true);
  assert.ok(!cardIds().includes('measurement-correction'));
  assert.ok(!cardIds().includes('cue-augmentation'));
  answer('role:2', 'both');
  assert.ok(!cardIds().includes('measurement-correction'));
  assert.ok(!cardIds().includes('cue-augmentation'));
});
test('A procedure answer applies only to the named input', () => {
  graph(['shift', 'observed', 'observed', 'target'], [[1, 2], [1, 3], [2, 4], [3, 4]]);
  answer('role:2', 'measurement');
  answer('role:3', 'measurement');
  answer('correction:2', 'yes');
  answer('correction:3', 'unknown');
  const card = value('computeStrategies().find(c => c.id === "measurement-correction")');
  assert.match(card.why, /N2/);
  assert.doesNotMatch(card.why, /N3/);
});
test('Weighting needs stable shifted predictors, deployment inputs, and confirmed coverage', () => {
  shiftedCause();
  for (const deployment of ['none', 'unknown']) {
    answer('deploymentData', deployment);
    assert.ok(!questionKeys().includes('coverage'));
    assert.ok(!cardIds().includes('covariate-weighting'));
  }
  for (const deployment of ['unlabelled', 'labelled']) {
    answer('deploymentData', deployment);
    for (const coverage of ['unknown', 'no']) {
      answer('coverage', coverage);
      assert.ok(!cardIds().includes('covariate-weighting'));
    }
    answer('coverage', 'yes');
    assert.ok(cardIds().includes('covariate-weighting'));
  }
  answer('deploymentData', 'none');
  assert.equal(run('S.answers.coverage'), null);
  answer('deploymentData', 'unlabelled');
  assert.ok(!cardIds().includes('covariate-weighting'));
});
test('Weighting is not suggested for unchanged predictors or a shifted target mechanism', () => {
  graph(['shift', 'observed', 'observed', 'target'], [[1, 2], [3, 4]]);
  assert.equal(run('graphAnalysis().predictorSets.length'), 1);
  assert.equal(run('graphAnalysis().weightingPredictors.length'), 0);
  answer('deploymentData', 'unlabelled');
  assert.ok(!questionKeys().includes('coverage'));
  assert.ok(!cardIds().includes('covariate-weighting'));
  graph(['shift', 'target', 'observed'], [[1, 2], [2, 3]]);
  answer('deploymentData', 'labelled');
  assert.ok(!questionKeys().includes('coverage'));
  assert.ok(!cardIds().includes('covariate-weighting'));
});
test('Local update needs labelled deployment data and permission with separate evaluation data', () => {
  shiftedCause();
  for (const deployment of ['none', 'unlabelled', 'unknown']) {
    answer('deploymentData', deployment);
    assert.ok(!questionKeys().includes('localUpdate'));
    assert.ok(!cardIds().includes('local-update'));
  }
  answer('deploymentData', 'labelled');
  for (const update of ['unknown', 'no']) {
    answer('localUpdate', update);
    assert.ok(!cardIds().includes('local-update'));
  }
  answer('localUpdate', 'yes');
  assert.ok(cardIds().includes('local-update'));
  answer('deploymentData', 'unlabelled');
  assert.equal(run('S.answers.localUpdate'), null);
  assert.ok(!cardIds().includes('local-update'));
  answer('deploymentData', 'labelled');
  assert.ok(!cardIds().includes('local-update'));
});
test('The conditional question route reaches all six cards with explicit requirements', () => {
  shiftedCause();
  run('navigate(1)');
  assert.equal(run('S.step'), 1);
  [
    ['trainingEnvironments', 'multiple_identified'], ['worstGroup', 'yes'],
    ['deploymentData', 'labelled'], ['localUpdate', 'yes'], ['role:2', 'both'],
    ['correction:2', 'yes'], ['augmentation:2', 'yes'], ['coverage', 'yes'],
  ].forEach(([key, val]) => {
    assert.equal(run('S.questionKey'), key);
    answer(key, val);
    run('advanceDetailQuestion()');
  });
  assert.equal(run('S.step'), 2);
  assert.deepEqual(new Set(cardIds()), new Set([
    'stable-features', 'measurement-correction', 'cue-augmentation',
    'group-dro', 'covariate-weighting', 'local-update',
  ]));
});
test('Free-text notes cannot enable strategies', () => {
  shiftedCause();
  run("S.structAssump='linear'; S.funcAssump='additive; allow local training and preprocessing'");
  assert.deepEqual(cardIds(), ['stable-features']);
});
test('Structural edits clear graph-specific answers but retain shared operational answers', () => {
  shiftedCause();
  answer('trainingEnvironments', 'multiple_identified');
  answer('worstGroup', 'yes');
  answer('deploymentData', 'labelled');
  answer('localUpdate', 'yes');
  answer('coverage', 'yes');
  answer('role:2', 'both');
  answer('correction:2', 'yes');
  answer('augmentation:2', 'yes');
  run('removeEdge(2,3)');
  assert.deepEqual(value('S.answers.inputRoles'), {});
  assert.deepEqual(value('S.answers.corrections'), {});
  assert.deepEqual(value('S.answers.augmentations'), {});
  assert.equal(run('S.answers.coverage'), null);
  assert.equal(run('S.answers.trainingEnvironments'), 'multiple_identified');
  assert.equal(run('S.answers.worstGroup'), 'yes');
  assert.equal(run('S.answers.deploymentData'), 'labelled');
  assert.equal(run('S.answers.localUpdate'), 'yes');
  assert.equal(run('graphAnalysis().predictorSets.length'), 0);
  assert.deepEqual(new Set(cardIds()), new Set(['group-dro', 'local-update']));
});
test('Changing, removing, or replacing the target resets answers; renaming retains them', () => {
  function setSharedAnswers() {
    answer('trainingEnvironments', 'multiple_identified');
    answer('worstGroup', 'yes');
    answer('deploymentData', 'labelled');
    answer('localUpdate', 'yes');
  }
  function assertAnswersReset() {
    ['trainingEnvironments', 'deploymentData', 'worstGroup', 'localUpdate', 'coverage'].forEach(key => {
      assert.equal(run(`S.answers.${key}`), null);
    });
    ['inputRoles', 'corrections', 'augmentations'].forEach(key => {
      assert.deepEqual(value(`S.answers.${key}`), {});
    });
  }
  shiftedCause();
  setSharedAnswers();
  answer('coverage', 'yes');
  answer('role:2', 'both');
  answer('correction:2', 'yes');
  answer('augmentation:2', 'yes');
  const originalAnswers = value('S.answers');
  assert.equal(run("renameNode(3, 'Renamed target')"), null);
  assert.deepEqual(value('S.answers'), originalAnswers);
  assert.equal(run("setNodeType(2, 'target')"), null);
  assertAnswersReset();

  shiftedCause();
  setSharedAnswers();
  assert.equal(run("addNode('New target', 'target', { x: 200, y: 100 })"), null);
  assertAnswersReset();

  shiftedCause();
  setSharedAnswers();
  run('removeNode(3)');
  assertAnswersReset();
});
test('Loading another graph clears all previous answers and notes', () => {
  shiftedCause();
  answer('trainingEnvironments', 'multiple_identified');
  answer('worstGroup', 'yes');
  answer('deploymentData', 'labelled');
  answer('localUpdate', 'yes');
  answer('coverage', 'yes');
  answer('role:2', 'both');
  answer('correction:2', 'yes');
  answer('augmentation:2', 'yes');
  run("S.structAssump='old notes'; S.funcAssump='old notes'; applyGraph(EXAMPLES[0].graph)");
  assert.equal(run('S.structAssump'), '');
  assert.equal(run('S.funcAssump'), '');
  ['trainingEnvironments', 'deploymentData', 'worstGroup', 'localUpdate', 'coverage'].forEach(key => {
    assert.equal(run(`S.answers.${key}`), null);
  });
  ['inputRoles', 'corrections', 'augmentations'].forEach(key => {
    assert.deepEqual(value(`S.answers.${key}`), {});
  });
  assert.deepEqual(cardIds(), ['stable-features']);
});
test('User names are escaped in questions, summaries, and strategy cards', () => {
  shiftedCause();
  run("S.nodes[1].name='<img src=x onerror=alert(1)>'");
  answer('role:2', 'both');
  answer('correction:2', 'yes');
  answer('augmentation:2', 'yes');
  run("S.step=1; S.questionKey='role:2'; renderStep1()");
  assert.match(element('step1').innerHTML, /&lt;img/);
  assert.doesNotMatch(element('step1').innerHTML, /<img/);
  run('showStrategies()');
  assert.match(element('step2').innerHTML, /&lt;img/);
  assert.doesNotMatch(element('step2').innerHTML, /<img/);
});
console.log(`${count} workflow tests passed.`);
if (failures) { console.error(`${failures} workflow tests failed.`); process.exitCode = 1; }
