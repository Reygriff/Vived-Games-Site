localStorage.setItem("introPlayed", "true");

const hamburgerMenu = document.querySelector(".hamburger-menu");

if (hamburgerMenu) {
    const hamburger = hamburgerMenu.querySelector(".hamburger");

    hamburgerMenu.addEventListener("click", e => {
        if (e.target.closest(".menu-box a")) return;
        if (e.target.closest(".nav-profile-btn")) return;
        if (e.target.closest("[data-nav-logout]")) return;
        if (e.target.closest(".nav-profile-dropdown a")) return;
        if (e.target.closest(".menu-box") && !e.target.closest(".hamburger")) return;

        hamburgerMenu.classList.toggle("open");
    });

    hamburgerMenu.querySelectorAll(".menu-box a").forEach(link => {
        link.addEventListener("click", () => {
            hamburgerMenu.classList.remove("open");
        });
    });

    if (hamburger) {
        hamburger.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                hamburgerMenu.classList.toggle("open");
            }
        });
    }

    document.addEventListener("click", e => {
        if (!hamburgerMenu.contains(e.target)) {
            hamburgerMenu.classList.remove("open");
        }
    });
}
