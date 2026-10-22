# Domain Generalization Copilot

A browser app that helps ML engineers and healthcare AI developers assess data shifts before training or deploying a model. The app uses fixed graph checks and rules. It does not use an LLM.

The app is based on *A Causal Framework for Mitigating Data Shifts in Healthcare* (Butler et al., 2026; [preprint](https://arxiv.org/abs/2603.13595)). Its design can differ from the paper.

**Try it live:** [chai-uk.github.io/domain-generalization-copilot](https://chai-uk.github.io/domain-generalization-copilot/)

## Workflow

1. **Graph Builder:** Add the target, observed inputs, latent variables, and shift variables. Continue to the questions or select **View preliminary recommendations**.
2. **Problem Details:** Answer conditional questions, one at a time. Optional causal notes are available in a collapsed section. This stage combines the former Stages II and III.
3. **Deployment Strategies:** Review a green problem summary and strategy cards. This was Stage IV. **Other strategies** opens the first unanswered question, or the first question if all are answered.

Users can view recommendations without completing the questions. With no confirmed answers, only the stable predictor card can appear. Each strategy card gives an action, method, reason, required checks, and trade-off. A resource-link element is reserved but hidden.

## Question rules

No questions appear if the graph has no observed inputs. Otherwise, the app uses these seven question types. Questions about inputs and procedures repeat only for relevant inputs.

| Question type | When asked |
| --- | --- |
| Training environments | Always. Options distinguish one environment, several without identifiers, several with identifiers, and unknown. |
| Deployment data before use | Always. Options are none, unlabelled, labelled, and unknown. |
| Priority for the weakest recorded environment | Only after confirming several labelled training environments with identifiers. |
| Local model update and separate local test data | Only when labelled deployment data are available. A positive answer confirms permission to update and separate labelled test data. |
| Role of an affected input | For each observed input downstream of a shift and connected to the target without traversing shift nodes. Options are measurement, editable cue, both, neither, and unknown. |
| Known input procedure | Ask about correction for a measurement, safe training edits for a cue, or both for an input with both roles. Correction must preserve useful information and be available in training and deployment where needed. Edits must preserve the target value and useful clinical information. |
| Training coverage of deployment inputs | Only when deployment inputs are available and the graph identifies a stable predictor set with at least one shift-affected member. Ask about that entire set, including combinations of input values. |

## Strategy rules

These are options to test, not guarantees of accuracy or clinical suitability. `yes` must be explicit where required. Correction and augmentation cards list only inputs with confirmed procedures.

| Strategy ID and card | Required conditions |
| --- | --- |
| `stable-features`: Test the candidate stable predictors | A nonempty observed predictor set separates the target from every specified shift in the graph. No questionnaire answer is required. |
| `measurement-correction`: Correct the affected measurement | At least one relevant shift-affected input has role `measurement` or `both`, with correction confirmed. |
| `cue-augmentation`: Vary or remove the unstable cue | At least one relevant shift-affected input has role `cue` or `both`, with safe training edits confirmed. |
| `group-dro`: Protect performance across recorded environments | Observed inputs exist; labelled data come from several environments with identifiers; protecting the weakest recorded environment is a confirmed priority. Protection in new environments is not established. |
| `covariate-weighting`: Reweight training examples for deployment | The graph identifies a stable set with at least one shift-affected member; labelled or unlabelled deployment inputs are available; coverage is confirmed. Estimate weights using the same entire predictor set. |
| `local-update`: Update using labelled local data | Observed inputs exist; labelled deployment data are available; permission to update and separate local test data are confirmed. |

## Application Details

- Missing and unknown answers never enable a method. Notes do not enable methods.
- When an earlier answer hides a follow-up, the app clears that follow-up answer. Changing an input role also clears its procedure answers.
- Changing or removing the prediction target clears all questionnaire answers. Labels and local test data for the old target may not apply to the new one.
- Importing or replacing a graph clears notes and all answers. Saved JSON contains only the graph, positions, and annotations; it does not save questionnaire answers or causal notes.
- Changes to nodes, node types, or edges clear input roles, procedures, and coverage. Shared environment and data-access answers remain. Renaming or moving a node does not clear answers.

## Limitations 
- Stability uses d-separation with latent variables retained in the graph. Only observed inputs can be selected. The bounded search checks all target-connected observed inputs together, their ancestral subset, and each input alone. It does not enumerate or rank every possible set. Failure to find a set does not establish that robust prediction is impossible.
- Graph findings assume the graph is correct. Coverage and safe procedures are user-confirmed assumptions. Accuracy still needs evaluation on suitable data.
- Recommendations produced by the app are based on asympototic analysis. Results can vary for smaller data sets, and the app does not provide finite-sample guarantees. 
    - This point is especially subtle. Consider two predictors, A and B. Predictor A uses one scalar variable as an input, and predictor B uses an image as an input. Even if theoretically predictor B is a better predictor, the performance in practice for predictor A might be superior, because overall less parameters are needed to fit a model with less inputs. 

## Run and check

Open `index.html` in a browser. No build step is required.

With Node.js installed, run:

```sh
node tests/workflow.test.cjs
```

The checks cover graph rules, conditional questions, answer reset, cards, and navigation. They use a small DOM stub and do not test browser layout.

For optional checks in a real browser, use Node.js 22 or later and Microsoft Edge:

```sh
node tests/browser.test.cjs
```

Set `DG_BROWSER` to use another compatible Chromium browser executable. This test checks the stage flow, conditional questions, keyboard focus, summary colour, hidden resource slots, and mobile page width. It uses a separate temporary browser profile and leaves `test-result.json` in that profile for inspection.
