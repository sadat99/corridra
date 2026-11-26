const flagsDirectory = new URL("./flags/", document.currentScript.src);
const liveSite = "https://c.obsidianglobal.studio";
const places = {
  BD: ["Bangladesh", "bd"], CN: ["China", "cn"], EU: ["European Union", "eu"],
  GB: ["United Kingdom", "gb"], US: ["United States", "us"], AU: ["Australia", "au"],
  REGION: ["Key Asian markets", "region"], OTHER: ["Other or undecided", null]
};
const intents = {
  china: {
    job: "sourcing", market: "CN", role: "importer", title: "Find out what the quote really covers.",
    description: "Three suppliers quote for the same machine. Pick an offer to see what’s included and what still needs checking.",
    console: "Compare machinery offers"
  },
  sell: {
    job: "buyers", market: "EU", role: "exporter", title: "Find the buyers worth meeting.",
    description: "An apparel exporter is planning meetings around a trade fair. Compare the event list with a shortlist built around what the company can supply.",
    console: "Build a buyer shortlist"
  },
  delegation: {
    job: "delegations", market: "CN", role: "leader", title: "Give every meeting a job to do.",
    description: "Move through an example visit. Follow the commercial objective from the original brief to the action someone owns after the meeting.",
    console: "Follow a delegation"
  },
  other: {
    job: "other", market: "OTHER", role: "entering", title: "Start with the outcome you need.",
    description: "An overseas business wants to explore Bangladesh. A clear first brief lets the team assess the route and the work before an introduction is made.",
    console: "Shape an initial request"
  }
};
const jobs = {
  sourcing: ["china", "Source products from China", "Compare suppliers and confirm which visits or quotes will support your decision."],
  machinery_procurement: ["china", "Buy machinery", "Capture specifications, installation, commissioning and after-sales requirements."],
  buyers: ["sell", "Find buyers or distributors", "Define buyer fit, target markets and the reason for meeting."],
  trade_fairs: ["sell", "Get more from a trade fair", "Name the event and the buyers you want to see before, during or after it."],
  delegations: ["delegation", "Organise a delegation", "Tell us who is going, what they want to achieve and who will own the follow-up."],
  other: ["other", "Describe another need", "Name the outcome, the market and any deadline you already know."]
};
const quoteRows = [
  ["Supplier A", "USD 36,800", "FOB Ningbo · Installation included",
    "Freight and insurance are outside the quoted scope. Ask for the cost to reach Chattogram before comparing totals."],
  ["Supplier B", "USD 34,200", "Delivery terms unstated · Installation excluded",
    "This is the lowest figure on the page. Delivery terms and the extra installation cost must be confirmed before it can be ranked."],
  ["Supplier C", "USD 39,100", "CIF Chattogram · Installation unconfirmed",
    "The quote includes freight and insurance to Chattogram. Ask for written confirmation of installation and record any extra charges."]
];
const buyerRows = [
  ["Private-label knitwear buyer", "Potential fit", "The current range fits. Confirm its buying window and order size.", true],
  ["Fabric mill", "Outside brief", "The company supplies material. This mission requires a buyer of finished garments.", false],
  ["Fashion buying office", "Needs confirmation", "Ask who controls supplier selection before requesting a meeting.", true],
  ["Retail sourcing team outside the fair", "Potential fit", "The product category aligns. Confirm decision-maker access first.", true]
];
const programmePhases = [
  ["Before the visit", "Agree what each company needs", "Gather participant objectives. Look for hosts who can address at least one of them."],
  ["On the ground", "Test the right thing at the factory", "Use the same technical questions on each visit and record what the team actually observes."],
  ["After the visit", "Put a name and deadline on the follow-up", "The sourcing lead requests itemised quotes within two working days. The organiser sees shared progress."]
];
const alternateQuestions = [
  ["Goal", "What should happen?", "Find a Bangladeshi manufacturing partner able to produce an initial run."],
  ["Direction", "Where is the work?", "An overseas company is looking into Bangladesh. Corridra assesses inbound work case by case."],
  ["Next step", "What would help Corridra assess it?", "Share a specification, the target timeline and what has already been tried."]
];
const stages = {
  china: [
    ["Agree the requirement", "Specify the product or machine, when you need it and which costs and obligations the offers must cover."],
    ["Compare before choosing", "Check technical fit and evidence. Keep the original quotes and currencies visible beside gaps in scope."],
    ["Arrange a focused visit", "Ask the shortlisted supplier to show the operations or tests that matter to your decision."],
    ["Keep a record of the decision", "Record what the visit established, clarify remaining terms and assign the next action."]
  ],
  sell: [
    ["Define your buyer", "Share your offer, minimum order, capacity, target market, and any fair or visit dates."],
    ["Qualify a shortlist", "Look for category fit, buying authority and timing, including leads outside the fair."],
    ["Request the right meeting", "Approach the appropriate contact with a reason to meet and a clear agenda."],
    ["Turn interest into a next step", "Record who attended, what they requested, and who owns the sample, RFQ or follow-up."]
  ],
  delegation: [
    ["Agree why the group is going", "Capture the organiser’s objective and the separate commercial goals of each company."],
    ["Match hosts to the brief", "Assess potential hosts, meeting access and relevance before the agenda is confirmed."],
    ["Run the programme", "Coordinate the company meetings and visits. Keep personal work in each company’s private view."],
    ["Follow the commercial outcomes", "Record meetings held, follow-ups and their owners, with shared progress visible to the organiser."]
  ],
  other: [
    ["Describe the result you need", "Tell Corridra the goal and the origin, target market and deadline you know."],
    ["Establish whether the route fits", "The team reviews whether it can take on the work and asks what still needs to be clarified."],
    ["Agree the scope", "A person discusses what can be delivered and quotes for the work before it starts."],
    ["Agree how progress will be tracked", "Set expectations for updates, the decisions you need to make and who owns the next actions."]
  ]
};
const people = {
  exporter: ["Exporter", "Your offer, production capacity and markets of interest.", "A focused buyer shortlist, introductions and owned follow-ups."],
  importer: ["Importer", "The product or machine, quantity and delivery needs.", "Supplier checks, comparable offers and a plan for relevant visits."],
  machinery: ["Machinery buyer", "Specifications and the after-sales support you need.", "A comparison that surfaces installation, training, warranties and spares."],
  entering: ["Company entering Bangladesh", "The opportunity you want to pursue and what you already know.", "A case-by-case scope covering access and local execution Corridra can support."],
  buyer: ["Overseas buyer", "The supplier profile and screening requirements.", "A scoped sourcing plan and qualified candidates for review."],
  supplier: ["Supplier", "Respond to the requirement shared with you when you are ready.", "A private introduction with the relevant questions and an option to respond."],
  leader: ["Delegation leader", "The group, dates, programme goals and company objectives.", "One shared programme and separate company plans, with commercial follow-up."],
  helper: ["Local helper", "Relevant skills, location and availability.", "Assigned work with a clear brief and a way to submit what you learned."]
};

const find = selector => document.querySelector(selector);
const intentInputs = [...document.querySelectorAll("[name=intent]")];
const stageButtons = [...document.querySelectorAll("[data-stage]")];
const marketButtons = [...document.querySelectorAll("[data-market]")];
const directionButtons = [...document.querySelectorAll("[data-direction]")];
const personButtons = [...document.querySelectorAll("[data-person]")];
const jobInput = find("#job");
const originInput = find("#origin");
const destinationInput = find("#destination");
const timingInput = find("#timing");
const scopeInput = find("#scope");
const consoleBody = find("#console-body");
const consoleResult = find("#console-result");
const dialog = find("#brief-dialog");
const briefContent = find("#brief-content");
let currentIntent = "china";
let activeStage = 0;
let activeMarket = "CN";
let activeDirection = "out";
let routeExplored = false;
let editedBrief = false;
const drawTerrain = mountTerrain(find("[data-directive-terrain]"), false);
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
const motionButton = find("#atlas-motion");
let motionPaused = false;
let activePerson = "importer";
let personTouched = false;

function node(tag, copy, className) {
  const element = document.createElement(tag);
  if (copy) element.textContent = copy;
  if (className) element.className = className;
  return element;
}
function placeBadge(code) {
  const [name, flag] = places[code];
  const badge = node("span", "", "dh-place");
  if (flag) {
    const image = node("img");
    image.src = new URL(flag + ".svg", flagsDirectory).href;
    image.alt = "";
    image.width = 22;
    image.height = 15;
    badge.append(image);
  }
  badge.append(name);
  return badge;
}
function routeLine(origin, destination) {
  const line = node("div", "", "dh-route-line");
  line.append(placeBadge(origin), node("span", "to"), placeBadge(destination));
  return line;
}
function updateOptions(select, codes, selected) {
  select.replaceChildren(...codes.map(code => new Option(places[code][0], code, false, code === selected)));
}
function updateDestinations(preferred) {
  const codes = Object.keys(places).filter(code => code !== originInput.value || code === "OTHER");
  updateOptions(destinationInput, codes, codes.includes(preferred) ? preferred : "OTHER");
}
function setPressed(items, field, value) {
  items.forEach(button => button.setAttribute("aria-pressed", String(button.dataset[field] === String(value))));
}
function showResult(title, detail) {
  consoleResult.replaceChildren(node("strong", title), node("p", detail));
  refreshMotion(consoleResult);
}
function showQuotes() {
  const buttons = quoteRows.map(([supplier, price, terms, details]) => {
    const button = node("button", "", "dh-quote");
    button.type = "button";
    button.setAttribute("aria-pressed", "false");
    button.append(node("strong", supplier), node("span", price), node("small", terms));
    button.addEventListener("click", () => {
      buttons.forEach(item => item.setAttribute("aria-pressed", String(item === button)));
      showResult(supplier + " · Comparison pending", details);
    });
    return button;
  });
  consoleBody.replaceChildren(...buttons);
  showResult("Can you compare the total costs?", "Choose a supplier to see what its quoted price includes and what Corridra would ask about.");
}
function optionGroup(title, rows, onChoose) {
  const group = node("div", "", "dh-control-group");
  group.setAttribute("role", "group");
  group.setAttribute("aria-label", title);
  const buttons = rows.map((label, i) => {
    const button = node("button", label);
    button.type = "button";
    button.dataset.choice = String(i);
    button.addEventListener("click", () => {
      setPressed(buttons, "choice", i);
      onChoose(i);
    });
    return button;
  });
  group.append(...buttons);
  setPressed(buttons, "choice", 0);
  onChoose(0);
  return group;
}
function showBuyers() {
  const list = node("ul", "", "dh-example-list");
  const group = optionGroup("List view", ["Fair list", "Qualified shortlist"], mode => {
    const rows = mode === 0 ? buyerRows.slice(0, 3) : buyerRows.filter(row => row[3]);
    list.replaceChildren(...rows.map(([name, status, detail]) => {
      const item = node("li");
      item.append(node("strong", name), node("span", status), node("small", detail));
      return item;
    }));
    showResult(mode === 0 ? "Start with a reason to meet" : "The shortlist extends beyond the fair",
      mode === 0 ? "Attendance gives you a starting point. Corridra checks product fit, authority and timing."
        : "The retail sourcing team merits outreach. Its buying authority and availability still need confirmation.");
  });
  consoleBody.replaceChildren(group, list);
}
function showSequence(rows, name) {
  const group = optionGroup(name, rows.map(row => row[0]), i => {
    showResult(rows[i][1], rows[i][2]);
  });
  consoleBody.replaceChildren(group);
}
function drawExample() {
  const selected = intents[currentIntent];
  find("#example-title").textContent = selected.title;
  find("#example-description").textContent = selected.description;
  find("#console-title").textContent = selected.console;
  const line = currentIntent === "other" ? routeLine("OTHER", "BD") : routeLine("BD", selected.market);
  find("#example-route").replaceChildren(...line.children);
  if (currentIntent === "china") showQuotes();
  if (currentIntent === "sell") showBuyers();
  if (currentIntent === "delegation") showSequence(programmePhases, "Programme phase");
  if (currentIntent === "other") showSequence(alternateQuestions, "Request question");
  refreshMotion(consoleBody);
}
function drawStage() {
  const [title, detail] = stages[currentIntent][activeStage];
  const panel = find("#stage-record");
  panel.replaceChildren(node("h3", title), node("p", detail));
  setPressed(stageButtons, "stage", activeStage);
  refreshMotion(panel);
}
function facts(entries) {
  const list = node("dl");
  list.append(...entries.map(([name, detail]) => {
    const row = node("div");
    row.append(node("dt", name), node("dd", detail));
    return row;
  }));
  return list;
}
function drawPerson() {
  const [title, give, get] = people[activePerson];
  const panel = find("#role-record");
  panel.replaceChildren(node("h3", title), facts([["You bring", give], ["You get", get]]));
  setPressed(personButtons, "person", activePerson);
  refreshMotion(panel);
}
function drawRoutes() {
  const inbound = activeDirection === "in";
  const origin = inbound ? activeMarket : "BD";
  const destination = inbound ? "BD" : activeMarket;
  const status = inbound ? "Selective · Assessed case by case" :
    activeMarket === "CN" ? "Sourcing focus" : "Sales enquiries · Scope confirmed per request";
  let detail = "Buyer and distributor access, plus meetings around trade fairs. Describe the customers and market you want to reach.";
  if (activeMarket === "CN") detail = "Source products, components or machinery. Compare offers and plan relevant factory and showroom visits.";
  if (activeMarket === "REGION") detail = "Describe the market you want to sell into so Corridra can review the assignment.";
  if (inbound) {
    detail = ["EU", "REGION"].includes(activeMarket)
      ? "Name the origin country in the live request. Corridra reviews inbound assignments individually."
      : "Share the opportunity and the country you are working from. Corridra reviews inbound assignments individually.";
  }
  const panel = find("#route-record");
  panel.replaceChildren(routeLine(origin, destination), node("p", status, "dh-route-status"), node("p", detail));
  const left = find("#atlas-bangladesh");
  const right = find("#atlas-market");
  left.replaceChildren(placeBadge("BD"), node("small", inbound ? "Destination" : "Origin"));
  right.replaceChildren(placeBadge(activeMarket), node("small", inbound ? "Origin" : "Destination"));
  const mode = inbound ? "selective" : "open";
  find(".dh-route-inspector").dataset.status = mode;
  drawTerrain?.(inbound, marketButtons.findIndex(button => button.dataset.market === activeMarket), mode);
  marketButtons.forEach(button => {
    const scope = button.querySelector("[data-outbound]");
    scope.textContent = inbound ? "Case by case" : scope.dataset.outbound;
  });
  setPressed(marketButtons, "market", activeMarket);
  setPressed(directionButtons, "direction", activeDirection);
  refreshMotion(panel);
}
function briefStatus() {
  const origin = originInput.value;
  const destination = destinationInput.value;
  const intent = jobs[jobInput.value][0];
  if (destination === "BD" && origin !== "BD") return "Selective route · Assessed case by case.";
  if (origin === "BD" && destination === "CN" && intent === "china") return "Sourcing focus · Bangladesh to China.";
  if (origin === "BD" && ["EU", "GB", "US", "AU", "REGION"].includes(destination) && intent === "sell") return "Sales enquiry · Corridra confirms scope and availability.";
  return "Ask Corridra to confirm scope and availability.";
}
function updateBrief() {
  const [,title,hint] = jobs[jobInput.value];
  find("#preview-title").textContent = title;
  const line = routeLine(originInput.value, destinationInput.value);
  find("#mission-route").replaceChildren(...line.children);
  find("#mission-fit").textContent = briefStatus();
  find("#draft-timing").textContent = timingInput.value || "To be discussed";
  find("#draft-note").textContent = scopeInput.value.trim() || "Your notes appear here.";
  scopeInput.placeholder = hint;
}
function chooseIntent(next, configureBrief = true) {
  currentIntent = next;
  intentInputs.forEach(input => { input.checked = input.value === next; });
  if (!personTouched) {
    activePerson = intents[next].role;
    drawPerson();
  }
  if (configureBrief && !editedBrief) {
    jobInput.value = intents[next].job;
    originInput.value = "BD";
    updateDestinations(intents[next].market);
    updateBrief();
  }
  if (!routeExplored && (next === "china" || next === "sell" || next === "delegation")) {
    activeMarket = intents[next].market;
    activeDirection = "out";
    drawRoutes();
  }
  activeStage = 0;
  drawExample();
  drawStage();
}
function requestUrl(help) {
  const query = new URLSearchParams();
  if (!help && jobInput.value !== "other") query.set("job", jobInput.value);
  if (!["EU", "REGION", "OTHER"].includes(originInput.value)) query.set("companyCountry", originInput.value);
  if (!["REGION", "OTHER"].includes(destinationInput.value)) query.set("marketCode", destinationInput.value);
  const values = query.toString();
  return liveSite + "/plan" + (values ? "?" + values : "");
}
function openBrief(help) {
  const title = node("h2", help ? "Have the team assess your request" : jobs[jobInput.value][1]);
  const send = node("a", help ? "Open Corridra’s request form" : "Continue to Corridra", "dh-button");
  send.href = requestUrl(help);
  const actions = node("div", "", "dh-dialog-actions");
  actions.append(send);
  const notes = scopeInput.value.trim();
  const timing = timingInput.value || "To be discussed";
  const details = node("div");
  details.append(node("p", "Timing · " + timing), node("p", notes || "You can add details in the live request.", "dh-dialog-note"));
  if ((notes || timingInput.value) && navigator.clipboard) {
    const copyButton = node("button", "Copy draft details", "dh-text-action");
    copyButton.type = "button";
    copyButton.addEventListener("click", async () => {
      try {
        const details = [timingInput.value && "Timing: " + timingInput.value, notes].filter(Boolean).join("\n");
        await navigator.clipboard.writeText(details);
        copyButton.textContent = "Draft details copied";
      } catch {
        copyButton.textContent = "Select the details above to copy them";
      }
    });
    actions.append(copyButton);
  }
  briefContent.replaceChildren(routeLine(originInput.value, destinationInput.value), title, details,
    node("p", help
      ? "Describe what you need in the live request and the Corridra team can review it."
      : "The live form opens with the supported route and job selections. Bring over your timing and notes when you’re ready."),
    actions);
  dialog.showModal();
}

updateOptions(originInput, ["BD", "CN", "GB", "US", "AU", "OTHER"], "BD");
const initialIntent = {source:"china",sell:"sell",programme:"delegation"}[new URLSearchParams(location.search).get("goal")];
chooseIntent(initialIntent || "china");
drawRoutes();
intentInputs.forEach(input => input.addEventListener("change", () => chooseIntent(input.value)));
stageButtons.forEach(button => button.addEventListener("click", () => { activeStage = Number(button.dataset.stage); drawStage(); }));
personButtons.forEach(button => button.addEventListener("click", () => { activePerson = button.dataset.person; personTouched = true; drawPerson(); }));
marketButtons.forEach(button => button.addEventListener("click", () => {
  routeExplored = true;
  activeMarket = button.dataset.market;
  drawRoutes();
}));
directionButtons.forEach(button => button.addEventListener("click", () => {
  routeExplored = true;
  activeDirection = button.dataset.direction;
  drawRoutes();
}));
function showMotionControl() {
  motionButton.hidden = reduceMotion.matches || !drawTerrain;
  motionButton.textContent = motionPaused ? "Resume motion" : "Pause motion";
}
motionButton.addEventListener("click", () => {
  motionPaused = !motionPaused;
  drawTerrain?.pause(motionPaused);
  showMotionControl();
});
reduceMotion.addEventListener("change", showMotionControl);
showMotionControl();
find("#mission-form").addEventListener("input", () => { editedBrief = true; });
jobInput.addEventListener("change", () => {
  const next = jobs[jobInput.value][0];
  if (next !== currentIntent) {
    if (originInput.value === "BD") updateDestinations(intents[next].market);
    chooseIntent(next, false);
  }
  updateBrief();
});
originInput.addEventListener("change", () => {
  const previous = destinationInput.value;
  updateDestinations(originInput.value === "BD" ? intents[currentIntent].market : previous === originInput.value ? "BD" : previous);
  updateBrief();
});
destinationInput.addEventListener("change", updateBrief);
timingInput.addEventListener("change", updateBrief);
scopeInput.addEventListener("input", updateBrief);
find("#route-use").addEventListener("click", () => {
  const inbound = activeDirection === "in";
  const next = inbound ? "other" : activeMarket === "CN" ? "china" : "sell";
  routeExplored = true;
  chooseIntent(next, false);
  if (jobs[jobInput.value][0] !== next) jobInput.value = intents[next].job;
  if (inbound && ![...originInput.options].some(option => option.value === activeMarket)) {
    originInput.add(new Option(places[activeMarket][0], activeMarket));
  }
  originInput.value = inbound ? activeMarket : "BD";
  updateDestinations(inbound ? "BD" : activeMarket);
  updateBrief();
});
find("#mission-form").addEventListener("submit", event => { event.preventDefault(); openBrief(false); });
find("#help-button").addEventListener("click", () => openBrief(true));
document.querySelectorAll("[data-example]").forEach(link => {
  link.addEventListener("click", () => {
    const inbound = link.hasAttribute("data-inbound");
    chooseIntent(link.dataset.example, !inbound);
    if (inbound) {
      jobInput.value = "other";
      if (originInput.value === "BD") originInput.value = "OTHER";
      updateDestinations("BD");
      updateBrief();
    }
  });
});

const menus = [...document.querySelectorAll("[data-menu]")];
menus.forEach(menu => {
  menu.addEventListener("click", event => {
    const link = event.target.closest("a");
    if (!link) return;
    menu.open = false;
    if (link.hash && link.getAttribute("href").startsWith("#")) {
      const section = document.getElementById(link.hash.slice(1));
      if (section) {
        section.tabIndex = -1;
        section.focus({preventScroll: true});
      }
    }
  });
  menu.addEventListener("keydown", event => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
      event.stopPropagation();
    }
  });
});
document.addEventListener("click", event => {
  menus.forEach(menu => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
});
attachParallax(find(".dh-hero"), 30);
