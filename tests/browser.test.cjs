// Optional real-browser checks. Requires Node.js 22+ and Microsoft Edge.
// Run with: node tests/browser.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const browser = process.env.DG_BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-copilot-browser-'));
const reportFile = path.join(profile, 'test-result.json');
fs.writeFileSync(reportFile, JSON.stringify({ status: 'running' }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const child = spawn(browser, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'],
  });
  let errors = '';
  child.stderr.on('data', data => { errors = (errors + data).slice(-4000); });
  const pending = new Map();
  let socket;
  try {
    child.on('error', error => { errors += String(error); });
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 80 && !fs.existsSync(portFile); i++) {
      if (child.exitCode !== null) throw new Error(`Browser exited: ${errors}`);
      await pause(100);
    }
    if (!fs.existsSync(portFile)) throw new Error(`Browser did not start: ${errors}`);
    const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
    const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let sequence = 0;
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      const handler = pending.get(message.id);
      if (handler) { pending.delete(message.id); handler(message); }
    };
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 5000);
      pending.set(id, message => { clearTimeout(timer); message.error ? reject(new Error(message.error.message)) : resolve(message.result); });
      socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async expression => {
      const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text + ': ' + JSON.stringify(response.exceptionDetails.exception));
      return response.result.value;
    };
    await send('Page.enable');
    await send('Page.navigate', { url: pathToFileURL(path.join(__dirname, '..', 'index.html')).href });
    for (let i = 0; i < 40; i++) {
      if (await evaluate('typeof computeStrategies === "function" && document.readyState === "complete"')) break;
      await pause(100);
    }
    assert.equal(await evaluate('document.querySelectorAll(".step-tab").length'), 3);
    await evaluate('loadExample(1)');
    const colourMatches = await evaluate(`(() => {
      const holder = document.createElement('div');
      document.body.appendChild(holder);
      const matches = ['observed', 'target', 'shift', 'latent'].map(type => {
        const node = S.nodes.find(n => n.type === type);
        holder.innerHTML = variableBadge(node.id);
        const badge = getComputedStyle(holder.firstElementChild);
        const menu = getComputedStyle(document.querySelector('.type-sel.type-' + type));
        return ['backgroundColor', 'color', 'borderTopColor'].every(property => badge[property] === menu[property]);
      });
      holder.remove();
      return matches;
    })()`);
    assert.deepEqual(colourMatches, [true, true, true, true]);
    await evaluate('showStrategies()');
    assert.match(await evaluate('document.querySelector(".step-panel.active h2").textContent'), /III\. Deployment Strategies/);
    assert.equal(await evaluate('document.querySelectorAll("[data-strategy]").length'), 1);
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".problem-summary")).backgroundColor'), 'rgb(240, 253, 244)');
    assert.equal(await evaluate('document.querySelectorAll("[data-strategy=stable-features] .variable-ref-observed").length'), await evaluate('graphAnalysis().predictorSets.flat().length'));
    assert.equal(await evaluate('document.querySelectorAll(".problem-summary .variable-ref-target").length'), 1);
    assert.equal(await evaluate('document.querySelectorAll(".problem-summary .variable-ref-shift").length'), 1);
    await evaluate('document.querySelector(".strat-card:last-child button").click()');
    assert.match(await evaluate('document.querySelector(".step-panel.active h2").textContent'), /II\. Problem Details/);
    await evaluate('document.querySelector("input[value=multiple_identified]").click()');
    assert.equal(await evaluate('document.activeElement.value'), 'multiple_identified');
    await evaluate('document.getElementById("btn-next").click()');
    assert.match(await evaluate('document.querySelector("legend").textContent'), /weakest/);
    await evaluate('document.querySelector("input[value=yes]").click(); document.getElementById("btn-preliminary").click()');
    assert.equal(await evaluate('document.querySelectorAll("[data-strategy=group-dro]").length'), 1);
    assert.equal(await evaluate('document.querySelector("[data-strategy] .strat-resources").hidden'), true);
    await evaluate('startDetails(); S.questionKey="role:5"; renderAll()');
    assert.equal(await evaluate('document.querySelector("legend .variable-ref-observed").textContent'), 'Markings');
    await evaluate('selectAnswer("role:5", "both"); S.questionKey="correction:5"; renderAll()');
    assert.equal(await evaluate('document.querySelector("legend .variable-ref-observed").textContent'), 'Markings');
    await evaluate('S.questionKey="augmentation:5"; renderAll()');
    assert.equal(await evaluate('document.querySelector("legend .variable-ref-observed").textContent'), 'Markings');
    await evaluate('selectAnswer("deploymentData", "unlabelled"); S.questionKey="coverage"; renderAll()');
    assert.equal(await evaluate('document.querySelectorAll(".question-fieldset .q-hint .variable-ref-observed").length'), await evaluate('graphAnalysis().weightingPredictors.length'));
    await evaluate('showStrategies()');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await evaluate('S.nodes.find(n => n.name === "Skin Appearance").name = "LongInputName".repeat(15); renderStep2()');
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    console.log('PASS real browser: matching node colours, questionnaire labels, stages, cards, focus, resources, long names at mobile width');
    await send('Browser.close');
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    if (child.exitCode === null) child.kill();
    // Leave the unique temporary profile for inspection; never use a personal profile.
  }
}
main().then(() => {
  fs.writeFileSync(reportFile, JSON.stringify({ status: 'passed' }));
}).catch(error => {
  fs.writeFileSync(reportFile, JSON.stringify({ status: 'failed', error: error.message }));
  console.error(error.message); process.exitCode = 1;
});
