const markets = {
  bd: "Bangladesh", cn: "China", eu: "European Union", uk: "United Kingdom",
  us: "United States", au: "Australia", as: "Key Asian markets"
};
function place(code) {
  const wrapper = document.createElement("span");
  wrapper.className = "place";
  const flag = document.createElement("span");
  flag.className = "flag " + code;
  flag.setAttribute("aria-hidden", "true");
  wrapper.append(flag, markets[code]);
  return wrapper;
}
function showRoute(target, origin, destination) {
  const separator = document.createElement("span");
  separator.className = "to-word";
  separator.textContent = "to";
  target.replaceChildren(place(origin), separator, place(destination));
}
function addMarketOptions(select, choices, selected) {
  select.replaceChildren(...choices.map(code => new Option(markets[code], code, false, code === selected)));
}
function routeNote(origin, destination) {
  if (origin === "bd") return "Open route · Review the scope with Corridra.";
  if (destination === "bd") return "Selective route · Assessed case by case.";
  return "Ask Corridra about this route.";
}
function refreshMotion(element) {
  element.classList.remove("fade-new");
  void element.offsetWidth;
  element.classList.add("fade-new");
}
function attachParallax(surface, strength) {
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  surface.addEventListener("pointermove", event => {
    if (motion.matches || event.pointerType !== "mouse") return;
    const rect = surface.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - .5;
    const y = (event.clientY - rect.top) / rect.height - .5;
    surface.style.setProperty("--mx", x * strength + "px");
    surface.style.setProperty("--my", y * strength + "px");
  });
  surface.addEventListener("pointerleave", () => {
    surface.style.removeProperty("--mx");
    surface.style.removeProperty("--my");
  });
}
