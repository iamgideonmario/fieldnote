"use strict";

const publicHome = document.querySelector("#public-home");
const appShell = document.querySelector(".app-shell");
const accountPreview = document.querySelector("#account-preview");
const homeContent = document.querySelector("#home-content");
const pricingPage = document.querySelector("#pricing");
const pricingLink = document.querySelector("#pricing-link");
let previewMode = "login";

function showPublicPage() {
  const isPricing = window.location.hash === "#pricing";
  homeContent.hidden = isPricing;
  pricingPage.hidden = !isPricing;
  if (isPricing) pricingLink.setAttribute("aria-current", "page");
  else pricingLink.removeAttribute("aria-current");
  if (!publicHome.hidden) {
    if (window.location.hash === "#how-it-works") document.querySelector("#how-it-works").scrollIntoView();
    else window.scrollTo(0, 0);
  }
}

function openWorkspace() {
  if (accountPreview.open) accountPreview.close();
  publicHome.hidden = true;
  appShell.hidden = false;
  window.scrollTo(0, 0);
  document.querySelector(".navigation .active").focus();
}

function openHome() {
  appShell.hidden = true;
  publicHome.hidden = false;
  if (window.location.hash !== "#public-home") window.location.hash = "public-home";
  showPublicPage();
  document.querySelector(".landing-brand").focus();
}

function setAccountPreview(mode) {
  previewMode = mode;
  const signup = mode === "signup";
  document.querySelector("#account-preview-title").textContent = signup ? "Let's get to work." : "Welcome back.";
  document.querySelector("#account-preview-description").textContent = signup
    ? "Accounts aren't connected yet. This is a preview of the sign-up screen."
    : "Accounts aren't connected yet. This is a preview of the login screen.";
  document.querySelector("#account-switch-copy").textContent = signup ? "Already have an account?" : "New to Fieldnote?";
  document.querySelector("#account-switch").textContent = signup ? "Preview log in" : "Preview sign up";
}

document.querySelectorAll("[data-open-workspace]").forEach((button) => button.addEventListener("click", openWorkspace));
document.querySelector("[data-open-home]").addEventListener("click", openHome);
document.querySelectorAll("[data-account-preview]").forEach((button) => button.addEventListener("click", () => {
  setAccountPreview(button.dataset.accountPreview);
  accountPreview.showModal();
}));
document.querySelector(".account-close").addEventListener("click", () => accountPreview.close());
accountPreview.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    accountPreview.close();
  }
});
document.querySelector("#account-switch").addEventListener("click", () => setAccountPreview(previewMode === "login" ? "signup" : "login"));
window.addEventListener("hashchange", showPublicPage);
showPublicPage();
