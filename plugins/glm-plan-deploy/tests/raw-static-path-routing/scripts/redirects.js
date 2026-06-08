"use strict";

document
  .getElementById("relative-js-redirect")
  .addEventListener("click", () => {
    window.location.href = "pages/relative.html";
  });

document
  .getElementById("absolute-js-redirect")
  .addEventListener("click", () => {
    window.location.assign("/pages/absolute.html");
  });
