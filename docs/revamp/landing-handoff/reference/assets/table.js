const programme = {
  organiser: [
    [
      {title:"Agree visit objectives", time:"Before travel", state:"Ready for review", detail:"Confirm each company’s machine type, installation needs and decision deadline.", owner:"Programme coordinator", action:"Mark objectives reviewed"},
      {title:"Qualify the proposed hosts", time:"Before travel", state:"Needs confirmation", detail:"Request the manufacturer’s production address, a live demonstration slot and an English-language technical contact.", owner:"Local coordinator", action:"Record a confirmation request"}
    ],
    [
      {title:"Visit a packaging line", time:"Day 1 · 10:30", state:"Scheduled", detail:"Observe line changeover and maintenance access. Record observations after the visit before advancing the opportunity.", owner:"Visit lead", action:"Record visit as held"},
      {title:"Technical discussion", time:"Day 2 · 14:00", state:"Scheduled", detail:"Discuss on-site commissioning, operator training and warranty exclusions with an engineering representative.", owner:"Technical lead", action:"Record discussion as held"}
    ],
    [
      {title:"Request a comparable quote", time:"Within 2 working days", state:"Action due", detail:"Ask for installation, commissioning, training, warranty and spares in separate line items, with currencies and exclusions visible.", owner:"Sourcing lead", action:"Record request as sent"},
      {title:"Review commercial outcomes", time:"Within 10 working days", state:"Planned", detail:"Record which meetings were held, which produced an RFQ and which need further work.", owner:"Programme coordinator", action:"Mark review complete"}
    ]
  ],
  participant: [
    [
      {title:"Share my sourcing objective", time:"Before travel", state:"Ready for review", detail:"I need a packaging line and on-site installation support. I am comparing delivery dates and after-sales commitments.", owner:"You", action:"Confirm my objective"},
      {title:"Save questions for the host", time:"Before travel", state:"Open", detail:"Ask whether the quotation covers commissioning, operator training and a recommended spares kit.", owner:"You", action:"Save my questions"}
    ],
    [
      {title:"My packaging line visit", time:"Day 1 · 10:30", state:"Scheduled", detail:"Bring your output targets and sample packaging. Ask to see a product changeover during the demonstration.", owner:"You", action:"Save visit to my plan"},
      {title:"My technical discussion", time:"Day 2 · 14:00", state:"Scheduled", detail:"Bring an equipment layout and confirm utility requirements with the engineering representative.", owner:"You", action:"Save discussion to my plan"}
    ],
    [
      {title:"Send my technical specification", time:"Within 2 working days", state:"Action due", detail:"Share the production requirements and specify that commissioning and warranty need separate line items.", owner:"You", action:"Record specification as sent"},
      {title:"Compare my options", time:"Within 10 working days", state:"Planned", detail:"Compare the complete scope, including local service, required utilities and the delivery schedule.", owner:"You", action:"Mark comparison reviewed"}
    ]
  ]
};
const roleButtons = [...document.querySelectorAll("[data-role]")];
const phaseButtons = [...document.querySelectorAll("[data-phase]")];
const phaseRange = document.querySelector("#phase-range");
const eventList = document.querySelector("#programme-events");
const recordPanel = document.querySelector("#programme-record");
const actions = new Set();
let role = "organiser";
let phase = 0;
let selected = 0;
const actionKey = index => [role, phase, index].join("-");
showRoute(document.querySelector("#programme-route"), "bd", "cn");
function drawRecord(keepAction = false) {
  const info = programme[role][phase][selected];
  const key = actionKey(selected);
  const complete = actions.has(key);
  const tag = document.createElement("p");
  tag.className = "micro";
  tag.textContent = info.time;
  const name = document.createElement("h3");
  name.textContent = info.title;
  const description = document.createElement("p");
  description.textContent = info.detail;
  const owner = document.createElement("p");
  owner.textContent = "Owner · " + info.owner;
  const status = document.createElement("p");
  status.className = "record-status";
  status.textContent = complete ? "Action recorded in sample" : info.state;
  const action = document.createElement("button");
  action.className = "primary";
  action.type = "button";
  action.textContent = complete ? "Undo sample action" : info.action;
  action.addEventListener("click", () => {
    if (actions.has(key)) actions.delete(key); else actions.add(key);
    drawEvents();
    drawRecord(true);
  });
  recordPanel.replaceChildren(tag, name, description, owner, status, action);
  refreshMotion(recordPanel);
  if (keepAction) action.focus();
}
function drawEvents() {
  const events = programme[role][phase].map((item, i) => {
    const button = document.createElement("button");
    const title = document.createElement("b");
    const time = document.createElement("span");
    const status = document.createElement("small");
    title.textContent = item.title;
    time.textContent = item.time;
    status.textContent = actions.has(actionKey(i)) ? "Action recorded" : item.state;
    button.type = "button";
    button.setAttribute("aria-pressed", String(i === selected));
    button.append(title, time, status);
    button.addEventListener("click", () => {
      selected = i;
      for (const [index, row] of [...eventList.children].entries()) row.setAttribute("aria-pressed", String(index === selected));
      drawRecord();
    });
    return button;
  });
  eventList.replaceChildren(...events);
}
function redrawProgramme() {
  roleButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.role === role)));
  phaseButtons.forEach(button => button.setAttribute("aria-pressed", String(Number(button.dataset.phase) === phase)));
  phaseRange.value = String(phase);
  phaseRange.setAttribute("aria-valuetext", phaseButtons[phase].textContent);
  drawEvents();
  drawRecord();
}
function choosePhase(value) {
  phase = Number(value);
  selected = 0;
  redrawProgramme();
}
roleButtons.forEach(button => button.addEventListener("click", () => { role = button.dataset.role; selected = 0; redrawProgramme(); }));
phaseButtons.forEach(button => button.addEventListener("click", () => choosePhase(button.dataset.phase)));
phaseRange.addEventListener("input", () => choosePhase(phaseRange.value));
attachParallax(document.querySelector(".table-hero"), 12);
redrawProgramme();
