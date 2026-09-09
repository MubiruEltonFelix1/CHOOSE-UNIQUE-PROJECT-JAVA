// ============================================================================
// projects.js — Taken projects browse page
// ============================================================================
(function () {
  "use strict";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---- DOM references -------------------------------------------------
  const searchInput   = document.getElementById("projects-search");
  const listEl        = document.getElementById("projects-list");
  const countEl       = document.getElementById("projects-count");
  const emptyState    = document.getElementById("projects-empty");
  const loadingState  = document.getElementById("projects-loading");
  const loadMoreBtn   = document.getElementById("projects-load-more");
  const banner        = document.getElementById("projects-banner");
  const courseNameEl  = document.getElementById("course-name");

  // ---- State ----------------------------------------------------------
  let currentSearch  = "";
  let offset         = 0;
  let noMoreData     = false;
  let isLoading      = false;
  const loadedIds    = new Set();

  // Show the course unit name in the subtitle
  if (courseNameEl) courseNameEl.textContent = COURSE_UNIT;

  // ---- Helpers --------------------------------------------------------
  function normalize(str) {
    return String(str || "").trim().replace(/\s+/g, " ").toLowerCase();
  }

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function formatDate(iso) {
    try {
      return new Date(iso).toLocaleString(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      });
    } catch (e) { return iso; }
  }

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function showBanner(message, type) {
    banner.textContent = message;
    banner.className   = "banner" + (type ? " banner--" + type : "");
    banner.hidden      = false;
  }

  function hideBanner() {
    banner.hidden    = true;
    banner.textContent = "";
  }

  // ---- Row template ---------------------------------------------------
  function rowTemplate(row) {
    return `
      <span class="ledger__title">${escapeHtml(row.project_title)}</span>
      <span class="ledger__meta">
        <span class="ledger__tag ledger__tag--taken">Taken</span>
        <span>${escapeHtml(row.student_name)}</span>
        <span>${escapeHtml(row.registration_number)}</span>
        <span>${formatDate(row.created_at)}</span>
      </span>
    `;
  }

  function appendRow(row) {
    if (loadedIds.has(row.id)) return;
    loadedIds.add(row.id);
    const li = document.createElement("li");
    li.className    = "ledger__row";
    li.dataset.id   = row.id;
    li.innerHTML    = rowTemplate(row);
    listEl.appendChild(li);
  }

  // ---- Load submissions -----------------------------------------------
  async function loadProjects(reset) {
    if (isLoading) return;

    if (reset) {
      offset     = 0;
      noMoreData = false;
      listEl.innerHTML = "";
      loadedIds.clear();
    }

    if (noMoreData) return;

    isLoading          = true;
    loadingState.hidden = false;
    loadMoreBtn.disabled = true;
    hideBanner();

    try {
      let query = supabase
        .from("submissions")
        .select("id, student_name, registration_number, project_title, created_at", { count: "exact" })
        .eq("course_unit", COURSE_UNIT)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (currentSearch) {
        query = query.or(
          `project_title_normalized.ilike.%${normalize(currentSearch)}%,student_name_normalized.ilike.%${normalize(currentSearch)}%`
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      rows.forEach(appendRow);
      offset += rows.length;

      noMoreData           = rows.length < PAGE_SIZE;
      loadMoreBtn.hidden   = noMoreData;
      emptyState.hidden    = listEl.children.length > 0;

      // Update count label
      if (typeof count === "number") {
        if (!currentSearch) {
          countEl.textContent = count === 1
            ? "1 project taken"
            : `${count} projects taken`;
        } else {
          countEl.textContent = count === 1
            ? `1 result for "${currentSearch}"`
            : `${count} results for "${currentSearch}"`;
        }
      }
    } catch (err) {
      showBanner("Could not load projects: " + (err.message || "Unknown error"), "error");
    } finally {
      isLoading            = false;
      loadingState.hidden  = true;
      loadMoreBtn.disabled = false;
    }
  }

  // ---- Realtime — prepend new rows live --------------------------------
  function subscribeRealtime() {
    supabase
      .channel("public:submissions-projects")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "submissions" },
        (payload) => {
          const row = payload.new;
          if (row.course_unit !== COURSE_UNIT) return;
          // Only show if it matches the current search (or no search active)
          if (currentSearch) {
            const combined = normalize(row.project_title + " " + row.student_name);
            if (!combined.includes(normalize(currentSearch))) return;
          }
          if (loadedIds.has(row.id)) return;
          loadedIds.add(row.id);
          const li = document.createElement("li");
          li.className  = "ledger__row ledger__row--new";
          li.dataset.id = row.id;
          li.innerHTML  = rowTemplate(row);
          listEl.prepend(li);
          emptyState.hidden = true;
          // Bump count
          const current = parseInt(countEl.textContent) || 0;
          const newCount = current + 1;
          if (!currentSearch) {
            countEl.textContent = newCount === 1 ? "1 project taken" : `${newCount} projects taken`;
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "submissions" },
        (payload) => {
          const id = payload.old && payload.old.id;
          if (!id) return;
          const el = listEl.querySelector(`[data-id="${id}"]`);
          if (el) { el.remove(); loadedIds.delete(id); }
          emptyState.hidden = listEl.children.length > 0;
        }
      )
      .subscribe();
  }

  // ---- Search ---------------------------------------------------------
  const debouncedSearch = debounce(function () {
    currentSearch = searchInput.value.trim();
    loadProjects(true);
  }, 350);

  searchInput.addEventListener("input", debouncedSearch);
  loadMoreBtn.addEventListener("click", () => loadProjects(false));

  // ---- Init -----------------------------------------------------------
  loadProjects(true);
  subscribeRealtime();
})();
