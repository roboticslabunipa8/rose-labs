(() => {
  const pathname = window.location.pathname || "";
  const isHomePage = pathname === "/" || pathname.endsWith("/index.html") || pathname === "index.html";

  try {
    localStorage.removeItem("rose-theme");
  } catch {
    // Ignore storage access failures and fall back to the light theme.
  }

  try {
    const forceLoader = new URLSearchParams(window.location.search).has("force-loader");
    if (forceLoader) {
      sessionStorage.removeItem("rose-loader-seen");
    }

    if (isHomePage && !sessionStorage.getItem("rose-loader-seen")) {
      document.documentElement.classList.add("show-site-loader");
      sessionStorage.setItem("rose-loader-seen", "1");
    }
  } catch {
    if (isHomePage) {
      document.documentElement.classList.add("show-site-loader");
    }
  }

  document.documentElement.dataset.theme = "light";
  document.documentElement.style.colorScheme = "light";
})();
