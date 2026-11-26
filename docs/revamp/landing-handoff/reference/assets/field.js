const corridors = {
  cn: {
    title: "Packaging equipment manufacturer",
    summary: "A sample machinery supplier for a Bangladeshi buyer comparing installation and after-sales support.",
    fit: [["Requirement", "Automatic packaging line with commissioning."], ["Open question", "Can the supplier provide on-site training and local service?"]],
    evidence: [["Source record", "A sample quotation lists machine capacity and lead time."], ["Needs confirmation", "Commissioning, spare parts and training are absent from the quoted scope."]],
    next: [["Get comparable terms", "Ask for itemised commissioning, warranty and parts before comparing offers."], ["Then arrange a visit", "See the line in operation and agree what the technical team needs to observe."]]
  },
  eu: {
    title: "Apparel buying team",
    summary: "A sample buyer for a Bangladeshi exporter preparing meetings during a European trade fair.",
    fit: [["Requirement", "Knit basics with private-label capability."], ["Open question", "Who signs off on new suppliers and when does their buying window open?"]],
    evidence: [["Source record", "A sample public catalogue shows a knitwear assortment."], ["Needs confirmation", "The company’s sourcing brief and order volumes remain unconfirmed."]],
    next: [["Confirm the buying window", "Ask the category lead about timing, volumes and sample requirements."], ["Then request a meeting", "Send a scoped introduction with two relevant product examples."]]
  },
  uk: {
    title: "Workwear distributor",
    summary: "A sample distributor for a manufacturer looking for a UK sales channel.",
    fit: [["Requirement", "Recurring workwear ranges with size continuity."], ["Open question", "Will the distributor assess a second manufacturing partner?"]],
    evidence: [["Source record", "A sample line sheet identifies the distributor’s workwear categories."], ["Needs confirmation", "Supplier onboarding criteria and decision access are unconfirmed."]],
    next: [["Check the category brief", "Ask about stock commitments, quality requirements and seasonality."], ["Then meet the buyer", "Agree what samples and commercial terms should be discussed."]]
  },
  us: {
    title: "Homewares sourcing team",
    summary: "A sample buyer for a Bangladeshi homewares supplier exploring the US market.",
    fit: [["Requirement", "Woven storage and tabletop accessories."], ["Open question", "Is the buyer open to a short production run?"]],
    evidence: [["Source record", "A sample assortment sheet shows matching product categories."], ["Needs confirmation", "The trial volume and retail launch window still need confirmation."]],
    next: [["Ask about trial orders", "Confirm trial volume and delivery windows before preparing a quote."], ["Then present samples", "Prepare a narrow assortment matched to the buyer’s needs."]]
  },
  au: {
    title: "Hospitality procurement team",
    summary: "A sample buyer for a Bangladeshi producer of hotel textiles.",
    fit: [["Requirement", "Hard-wearing linens with replenishment capacity."], ["Open question", "Does the buyer require domestic stock or direct supply?"]],
    evidence: [["Source record", "A sample procurement brief specifies laundry cycles."], ["Needs confirmation", "Reorder cadence and preferred delivery terms still need confirmation."]],
    next: [["Confirm replenishment needs", "Discuss delivery and the buyer’s usage forecast."], ["Then compare specifications", "Review one sample batch against the agreed laundry requirements."]]
  },
  as: {
    title: "Industrial components distributor",
    summary: "A sample sourcing case in which the manufacturing location still needs to be confirmed.",
    fit: [["Requirement", "Replacement components for existing equipment."], ["Open question", "Which market and supplier meet the compatibility and service needs?"]],
    evidence: [["Source record", "A sample equipment schedule lists required part numbers."], ["Needs confirmation", "Product origin, compatibility and delivery terms remain open."]],
    next: [["Identify the specific market", "Check where the required parts can be sourced and serviced."], ["Then validate the supplier", "Confirm fit with a part sample or written compatibility evidence."]]
  }
};
const inbound = {
  title: "Contract manufacturing partner",
  summary: "A sample inbound case for an overseas business exploring manufacturing in Bangladesh.",
  fit: [["Requirement", "An operator with relevant production capability and spare capacity."], ["Open question", "The team needs to assess whether the assignment fits the selective inbound route."]],
  evidence: [["Source record", "A sample capability statement lists production categories."], ["Needs confirmation", "Capacity, lead time and who can approve a factory visit require confirmation."]],
  next: [["Clarify the requirement", "Give the Corridra team a product specification and target timeline."], ["Then check service fit", "Review delivery responsibilities before making an introduction."]]
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
const extra = {
  delegate: {
    title:"Factory visit host",
    summary:"A sample host for a delegation whose companies need to assess equipment, capacity and service.",
    fit:[["Requirement","A working site and technical team that can address the attending companies’ objectives."],["What to check","Can the host accommodate separate meetings and a live run?"]],
    evidence:[["Evidence available","The host provided a site address and draft agenda."],["Needs confirmation","The engineer and demonstration slot remain unconfirmed."]],
    next:[["Confirm the agenda","Assign an owner to confirm the host and demonstration."],["Track commercial outcomes","Record which meetings were held and who owns each company’s follow-up."]]
  },
  other: {
    title:"Market access request",
    summary:"An illustration of how Corridra scopes work outside its standard routes.",
    fit:[["Requirement","Name the market, the business goal and when you need an answer."],["What to check","Which decision are you trying to make, and what has already been tried?"]],
    evidence:[["Evidence available","A short brief states the commercial goal."],["Needs confirmation","Corridra’s delivery scope and route availability need review."]],
    next:[["Ask the team to assess the route","Explain the outcome and any known cities, dates or constraints."],["Agree the work","Review the scope and quote before any work begins."]]
  }
};
const steps = {
  buy:[["Define the technical brief","Share the machinery specification, quantity, commissioning needs and target delivery."],["Make offers comparable","Corridra checks technical fit and keeps original terms and currencies visible beside what is missing."],["Set the factory visit agenda","Agree which running test, equipment or maintenance task the engineer needs to see."],["Log the commercial decision","Record what was observed, update open questions and give the next action an owner."]],
  sell:[["Define your buyer","Share your offer, capacity, target market and dates for a fair or visit."],["Look beyond the fair list","Check product fit, decision access and timing for prospects in and outside the fair."],["Give the buyer a reason to meet","Send relevant product examples and agree a purpose for the conversation."],["Own the commercial follow-up","Track the sample, RFQ, quote or next call against the person responsible."]],
  delegate:[["Agree the programme objective","Keep each company’s commercial goals visible inside a shared programme."],["Qualify hosts and meetings","Match each potential host to a participant’s goal, then check availability and relevance."],["Coordinate the visit","Prepare a working agenda and record the visits or meetings that actually happen."],["Track commercial follow-up","Assign an owner for each company’s RFQ, sample or next meeting. Share the permitted programme progress."]],
  other:[["Describe the outcome","Share the market, business result and timing you know."],["Review whether the route fits","Corridra checks whether it can support the direction and work."],["Agree a scope","A person clarifies the requirement and quotes for the work."],["Agree how to track progress","Name the decision-maker, next action and evidence needed."]]
};
const jobInfo = {
  sourcing:["buy","Source products from China"],machinery_procurement:["buy","Buy machinery"],
  buyers:["sell","Find buyers or distributors"],trade_fairs:["sell","Get more from a trade fair"],
  delegations:["delegate","Organise a delegation"],other:["other","Describe another need"]
};
const defaults = {buy:["cn","sourcing","importer"],sell:["eu","buyers","exporter"],delegate:["cn","delegations","leader"],other:["other","other","entering"]};
const countryCodes = {bd:"BD",cn:"CN",eu:"EU",uk:"GB",us:"US",au:"AU"};
const flagCodes = {bd:"bd",cn:"cn",eu:"eu",uk:"gb",us:"us",au:"au",as:"region"};
const find = selector => document.querySelector(selector);
const choose = (selector, word, value) => document.querySelectorAll(selector).forEach(button => {
  button.setAttribute("aria-pressed", String(button.dataset[word] === String(value)));
});
const market = find("#field-market");
const reverseButton = find("#reverse-route");
const dossierButton = find("#shortlist");
const savedDialog = find("#saved-dialog");
const briefDialog = find("#brief-dialog");
const origin = find("#origin");
const destination = find("#destination");
const job = find("#job");
const timing = find("#timing");
const scope = find("#scope");
const drawRoute = mountTerrain(find("[data-terrain]"), false);
const saved = new Map();
let intent = "buy";
let reversed = false;
let layer = "fit";
let stage = 0;
let proof = "all";
let person = "importer";
let edited = false;
let chosePerson = false;
markets.other = "Another market";
function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function placeFlag(code) {
  const badge = element("span", "", "place");
  if (flagCodes[code]) {
    const image = element("img");
    image.src = "../assets/flags/" + flagCodes[code] + ".svg";
    image.alt = "";
    image.width = 21;
    image.height = 14;
    badge.append(image);
  }
  badge.append(markets[code]);
  return badge;
}
function routeLine(from, to) {
  const track = element("div", "", "route-inline");
  track.append(placeFlag(from), element("span","to","to-word"), placeFlag(to));
  return track;
}
function readiness(from,to,goal) {
  if (to === "bd" && !["bd","other"].includes(from)) return ["selective","Selective route · Assessed case by case."];
  if (from === "bd" && to === "cn" && goal === "buy") return ["open","Sourcing focus · Corridra reviews the scope."];
  if (from === "bd" && ["eu","uk","us","au","as"].includes(to) && goal === "sell") return ["open","Sales enquiries · Scope confirmed per request."];
  if (goal === "delegate" && from === "bd" && to === "cn") return ["ask","Programme scope · Confirm goals, hosts and dates with Corridra."];
  return ["ask","Ask Corridra about this scope and route."];
}
function route() {return reversed ? [market.value,"bd"] : ["bd",market.value];}
function profile() {
  if (market.value === "other") return extra.other;
  if (reversed) return inbound;
  if (intent === "delegate") return extra.delegate;
  return corridors[market.value];
}
function recordKey() {return [intent,market.value,reversed].join(":");}
function updateSaved() {
  const selected = saved.has(recordKey());
  find("#shortlist-total").textContent = saved.size;
  dossierButton.setAttribute("aria-pressed", String(selected));
  dossierButton.textContent = selected ? "Remove from shortlist" : "Save to shortlist";
}
function updateLayer() {
  const rows = profile()[layer].map(([title,copy]) => {
    const row = element("div","","dossier-entry");
    row.append(element("b",title),element("p",copy));
    return row;
  });
  const area = find("#dossier-layer");
  area.replaceChildren(...rows);
  choose("[data-layer]","layer",layer);
  refreshMotion(area);
}
function updateProof() {
  const dossier = profile();
  const [evidence, gap] = dossier.evidence;
  const records = [evidence,gap];
  if (!reversed && intent === "buy" && market.value === "cn") {
    records.push(["Outcome observed","In this sample, an engineer saw a demonstration. The record identifies what was actually tested."]);
  } else if (!reversed && intent === "delegate") {
    records.push(["Verified","In this sample, the site address was checked against the host’s business licence."]);
  }
  find("#ledger-title").textContent = dossier.title;
  const container = find("#field-proof");
  const entries = (proof === "open" ? [gap] : records).map(([title,copy]) => {
    const row = element("article");
    row.append(element("small",title),element("p",copy));
    return row;
  });
  container.replaceChildren(...entries);
  choose("[data-proof]","proof",proof);
  refreshMotion(container);
}
function updateStage() {
  const [title,copy] = steps[reversed || market.value === "other" ? "other" : intent][stage];
  const panel = find("#mission-record");
  panel.replaceChildren(element("h3",title),element("p",copy));
  choose("[data-stage]","stage",stage);
  refreshMotion(panel);
}
function updatePerson() {
  const [title,bring,get] = people[person];
  const panel = find("#role-record");
  const details = element("dl");
  for (const [label,copy] of [["You bring",bring],["You get",get]]) {
    const row = element("div");
    row.append(element("dt",label),element("dd",copy));
    details.append(row);
  }
  panel.replaceChildren(element("h3",title),details);
  choose("[data-person]","person",person);
}
function setDestinations(pick) {
  const choices = Object.keys(markets).filter(code => code !== origin.value || code === "other");
  addMarketOptions(destination,choices,choices.includes(pick) ? pick : "other");
}
function updateDraft() {
  const [goal,title] = jobInfo[job.value];
  find("#preview-title").textContent = title;
  find("#mission-route").replaceChildren(...routeLine(origin.value,destination.value).children);
  find("#mission-fit").textContent = readiness(origin.value,destination.value,goal)[1];
  find("#draft-timing").textContent = timing.value || "To be discussed";
  find("#draft-note").textContent = scope.value.trim() || "Your notes appear here.";
}
function syncDraft() {
  const [from,to] = route();
  origin.value = from;
  setDestinations(to);
  job.value = reversed ? "other" : defaults[intent][1];
  updateDraft();
}
function updateRoute() {
  const [from,to] = route();
  const [mode,message] = readiness(from,to,intent);
  const dossier = profile();
  const left = find("#map-origin");
  const right = find("#map-destination");
  left.replaceChildren(placeFlag("bd"));
  right.replaceChildren(placeFlag(market.value));
  left.dataset.direction = reversed ? "Destination" : "Origin";
  right.dataset.direction = reversed ? "Origin" : "Destination";
  find(".atlas").dataset.mode = mode;
  find("#route-availability").textContent = message;
  find("#dossier-title").textContent = dossier.title;
  find("#dossier-summary").textContent = dossier.summary;
  reverseButton.setAttribute("aria-pressed", String(reversed));
  drawRoute?.(reversed,market.selectedIndex,mode);
  choose("[data-intent]","intent",reversed ? "other" : intent);
  if (!chosePerson) {
    person = reversed ? "entering" : defaults[intent][2];
    updatePerson();
  }
  updateSaved();
  updateLayer();
  updateProof();
  updateStage();
  if (!edited) syncDraft();
}
function inferIntent() {
  if (reversed || intent === "delegate") return;
  intent = market.value === "cn" ? "buy" : market.value === "other" ? "other" : "sell";
}
function drawShortlist() {
  const list = find("#field-saved-list");
  if (!saved.size) {
    list.replaceChildren(element("p","Your shortlist is empty. Save a sample dossier to return to it here."));
    return;
  }
  const rows = [...saved].map(([id,record]) => {
    const item = element("article");
    item.append(element("h3",record.title),routeLine(...record.route));
    const inspect = element("button","Inspect dossier","dh-text-action");
    inspect.addEventListener("click", () => {
      market.value = record.market;
      intent = record.intent;
      reversed = record.reversed;
      updateRoute();
      savedDialog.close();
      find("#dossier-title").focus();
    });
    const remove = element("button","Remove","dh-text-action");
    remove.setAttribute("aria-label","Remove " + record.title + " from shortlist");
    remove.addEventListener("click", () => {
      saved.delete(id);
      updateSaved();
      drawShortlist();
      savedDialog.querySelector("button").focus();
    });
    item.append(inspect,remove);
    return item;
  });
  list.replaceChildren(...rows);
}
function openDraft(help) {
  const content = find("#brief-content");
  const query = new URLSearchParams();
  if (!help) {
    if (job.value !== "other") query.set("job",job.value);
    if (countryCodes[origin.value] && origin.value !== "eu") query.set("companyCountry",countryCodes[origin.value]);
    if (countryCodes[destination.value]) query.set("marketCode",countryCodes[destination.value]);
  }
  const action = element("a",help ? "Open Corridra’s request form" : "Continue to Corridra","dh-button");
  action.href = "https://c.obsidianglobal.studio/plan" + (query.size ? "?" + query : "");
  const actions = element("div","","dh-dialog-actions");
  actions.append(action);
  const notes = scope.value.trim();
  if (notes && navigator.clipboard) {
    const copy = element("button","Copy my notes","dh-text-action");
    copy.addEventListener("click",async () => {
      try {
        await navigator.clipboard.writeText(notes);
        copy.textContent = "Notes copied";
      } catch {
        copy.textContent = "Select the notes above to copy them";
      }
    });
    actions.append(copy);
  }
  content.replaceChildren(routeLine(origin.value,destination.value),
    element("h2",help ? "Ask the team to assess your scope" : jobInfo[job.value][1]),
    element("p","Timing · " + (timing.value || "To be discussed")),
    element("p",notes || "You can add the details in the live request.","dh-dialog-note"),
    element("p",help ? "Describe what you need and the Corridra team can review it." : "The live form opens with supported job and route choices. Bring over your notes and timing when you are ready."),
    actions);
  briefDialog.showModal();
}

addMarketOptions(market,[...Object.keys(corridors),"other"],"cn");
addMarketOptions(origin,Object.keys(markets),"bd");
document.querySelectorAll("[data-intent]").forEach(button => button.addEventListener("click", () => {
  intent = button.dataset.intent;
  market.value = defaults[intent][0];
  reversed = false;
  layer = "fit";
  stage = 0;
  updateRoute();
}));
market.addEventListener("change",() => {inferIntent();updateRoute();});
reverseButton.addEventListener("click",() => {reversed = !reversed;inferIntent();updateRoute();});
document.querySelectorAll("[data-layer]").forEach(button => button.addEventListener("click",() => {layer=button.dataset.layer;updateLayer();}));
document.querySelectorAll("[data-stage]").forEach(button => button.addEventListener("click",() => {stage=Number(button.dataset.stage);updateStage();}));
document.querySelectorAll("[data-proof]").forEach(button => button.addEventListener("click",() => {proof=button.dataset.proof;updateProof();}));
document.querySelectorAll("[data-person]").forEach(button => button.addEventListener("click",() => {person=button.dataset.person;chosePerson=true;updatePerson();}));
dossierButton.addEventListener("click",() => {
  const id = recordKey();
  if (saved.has(id)) saved.delete(id);
  else saved.set(id,{title:profile().title,intent,reversed,market:market.value,route:route()});
  updateSaved();
});
find("#view-saved").addEventListener("click",() => {drawShortlist();savedDialog.showModal();});
find("#use-route").addEventListener("click",syncDraft);
find("#mission-form").addEventListener("input",event => {
  edited = true;
  if (event.target === origin) setDestinations(destination.value);
  updateDraft();
});
find("#mission-form").addEventListener("submit",event => {event.preventDefault();openDraft(false);});
find("#help-button").addEventListener("click",() => openDraft(true));
find(".dh-menu").addEventListener("click",event => {
  if (event.target.closest("a")) find(".dh-menu").open = false;
});
updateRoute();
