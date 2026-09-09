// ============================================================================
// app.js — Student registration page logic
// ============================================================================
(function () {
  "use strict";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---- DOM references -------------------------------------------------
  const form = document.getElementById("submission-form");
  const nameInput = document.getElementById("student_name");
  const regInput = document.getElementById("registration_number");
  const titleInput = document.getElementById("project_title");
  const submitBtn = document.getElementById("submit-btn");
  const submitLabel = submitBtn.querySelector(".btn__label");
  const submitSpinner = submitBtn.querySelector(".btn__spinner");
  const formBanner = document.getElementById("form-banner");
  const regHint = document.getElementById("hint-registration_number");
  const titleHint = document.getElementById("hint-project_title");

  const searchInput = document.getElementById("search-input");
  const listEl = document.getElementById("submissions-list");
  const countEl = document.getElementById("submission-count");
  const emptyState = document.getElementById("empty-state");
  const loadingState = document.getElementById("loading-state");
  const loadMoreBtn = document.getElementById("load-more-btn");
  const realtimeBanner = document.getElementById("realtime-banner");

  // ---- State ------------------------------------------------------------
  let currentSearch = "";
  let offset = 0;
  let noMoreData = false;
  let isLoading = false;
  const loadedIds = new Set();

  // ---- Helpers ------------------------------------------------------------
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
    } catch (e) {
      return iso;
    }
  }

  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  function showBanner(el, message, type) {
    el.textContent = message;
    el.className = "banner" + (type ? " banner--" + type : "");
    el.hidden = false;
  }

  function hideBanner(el) {
    el.hidden = true;
    el.textContent = "";
  }

  function setFieldError(fieldId, message) {
    const el = document.getElementById("error-" + fieldId);
    const input = document.getElementById(fieldId);
    if (el) el.textContent = message || "";
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function clearFieldErrors() {
    ["student_name", "registration_number", "project_title"].forEach((id) => setFieldError(id, ""));
  }

  // ---- Client-side validation -------------------------------------------
  function validateForm(values) {
    let valid = true;
    clearFieldErrors();

    if (!values.student_name || values.student_name.length < 2) {
      setFieldError("student_name", "Enter your full name.");
      valid = false;
    } else if (values.student_name.length > 120) {
      setFieldError("student_name", "Name is too long.");
      valid = false;
    }

    if (!values.registration_number || values.registration_number.length < 3) {
      setFieldError("registration_number", "Enter a valid registration number.");
      valid = false;
    } else if (values.registration_number.length > 40) {
      setFieldError("registration_number", "Registration number is too long.");
      valid = false;
    }

    if (!values.project_title || values.project_title.length < 4) {
      setFieldError("project_title", "Project title must be at least 4 characters.");
      valid = false;
    } else if (values.project_title.length > 200) {
      setFieldError("project_title", "Project title is too long (max 200 characters).");
      valid = false;
    }

    return valid;
  }

  // ---- Pre-submit similarity warnings (advisory only) --------------------
  const checkTitleSimilarity = debounce(async function () {
    const value = titleInput.value;
    const norm = normalize(value);
    if (norm.length < 4) { titleHint.textContent = ""; return; }
    try {
      const { data, error } = await supabase
        .from("submissions")
        .select("project_title")
        .eq("course_unit", COURSE_UNIT)
        .eq("project_title_normalized", norm)
        .limit(1);
      if (error) return;
      if (data && data.length > 0) {
        titleHint.textContent = "⚠ This exact project title already exists — you won't be able to submit it.";
        titleHint.style.color = "var(--danger)";
      } else {
        titleHint.textContent = "";
      }
    } catch (e) { /* silent — this is advisory only */ }
  }, 450);

  const checkRegSimilarity = debounce(async function () {
    const value = regInput.value;
    const norm = normalize(value);
    if (norm.length < 3) { regHint.textContent = ""; return; }
    try {
      const { data, error } = await supabase
        .from("submissions")
        .select("registration_number")
        .eq("course_unit", COURSE_UNIT)
        .eq("registration_number_normalized", norm)
        .limit(1);
      if (error) return;
      if (data && data.length > 0) {
        regHint.textContent = "⚠ A submission already exists for this registration number.";
        regHint.style.color = "var(--danger)";
      } else {
        regHint.textContent = "";
      }
    } catch (e) { /* silent */ }
  }, 450);

  titleInput.addEventListener("input", checkTitleSimilarity);
  regInput.addEventListener("input", checkRegSimilarity);

  // ---- Form submission -----------------------------------------------------
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    hideBanner(formBanner);

    const values = {
      student_name: nameInput.value.trim(),
      registration_number: regInput.value.trim(),
      project_title: titleInput.value.trim(),
    };

    if (!validateForm(values)) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("submissions")
        .insert({
          student_name: values.student_name,
          registration_number: values.registration_number,
          project_title: values.project_title,
          course_unit: COURSE_UNIT,
        })
        .select()
        .single();

      if (error) {
        handleInsertError(error);
        return;
      }

      form.reset();
      titleHint.textContent = "";
      regHint.textContent = "";
      showBanner(formBanner, "Project submitted successfully. It now appears in the list below.", "success");

      if (data && !loadedIds.has(data.id)) {
        prependSubmission(data, true);
      }
    } catch (err) {
      showBanner(formBanner, "Network error — please check your connection and try again.", "error");
    } finally {
      setSubmitting(false);
    }
  });

  function handleInsertError(error) {
    const msg = (error.message || "") + " " + (error.details || "");
    const lower = msg.toLowerCase();

    if (error.code === "23505" || lower.includes("duplicate key")) {
      if (lower.includes("project_title") || lower.includes("uq_submissions_project_per_course")) {
        showBanner(formBanner, "This project has already been selected by another student. Please choose another project.", "error");
        setFieldError("project_title", "Already taken.");
      } else if (lower.includes("registration_number") || lower.includes("uq_submissions_regnum_per_course")) {
        showBanner(formBanner, "This registration number has already submitted a project.", "error");
        setFieldError("registration_number", "Already used.");
      } else {
        showBanner(formBanner, "This submission conflicts with an existing one. Please check your details.", "error");
      }
      return;
    }

    showBanner(formBanner, "Something went wrong while submitting. Please try again in a moment.", "error");
  }

  function setSubmitting(isSubmitting) {
    submitBtn.disabled = isSubmitting;
    submitSpinner.hidden = !isSubmitting;
    submitLabel.textContent = isSubmitting ? "Submitting…" : "Submit project";
  }

  // ---- Loading + rendering the list -----------------------------------------
  async function loadSubmissions(reset) {
    if (isLoading) return;
    if (reset) {
      offset = 0;
      noMoreData = false;
      listEl.innerHTML = "";
      loadedIds.clear();
    }
    if (noMoreData) return;

    isLoading = true;
    loadingState.hidden = false;
    loadMoreBtn.disabled = true;

    try {
      let query = supabase
        .from("submissions")
        .select("id, student_name, registration_number, project_title, created_at", { count: "exact" })
        .eq("course_unit", COURSE_UNIT)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (currentSearch) {
        query = query.ilike("project_title_normalized", `%${normalize(currentSearch)}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;

      data.forEach((row) => appendSubmission(row));
      offset += data.length;

      if (data.length < PAGE_SIZE) {
        noMoreData = true;
        loadMoreBtn.hidden = true;
      } else {
        loadMoreBtn.hidden = false;
      }

      if (!currentSearch && typeof count === "number") {
        countEl.textContent = count === 1 ? "1 project submitted" : `${count} projects submitted`;
      } else if (typeof count === "number") {
        countEl.textContent = `${count} match${count === 1 ? "" : "es"} for "${currentSearch}"`;
      }

      emptyState.hidden = listEl.children.length > 0;
    } catch (err) {
      showBanner(realtimeBanner, "Could not load submissions. Retrying may help — check your connection.", "error");
    } finally {
      isLoading = false;
      loadingState.hidden = true;
      loadMoreBtn.disabled = false;
    }
  }

  function rowTemplate(row) {
    return `
      <span class="ledger__title">${escapeHtml(row.project_title)}</span>
      <span class="ledger__meta">
        <span>${escapeHtml(row.student_name)}</span>
        <span>${escapeHtml(row.registration_number)}</span>
        <span>${formatDate(row.created_at)}</span>
      </span>
    `;
  }

  function appendSubmission(row) {
    if (loadedIds.has(row.id)) return;
    loadedIds.add(row.id);
    const li = document.createElement("li");
    li.className = "ledger__row";
    li.dataset.id = row.id;
    li.innerHTML = rowTemplate(row);
    listEl.appendChild(li);
  }

  function prependSubmission(row, highlight) {
    if (loadedIds.has(row.id)) return;
    loadedIds.add(row.id);
    const li = document.createElement("li");
    li.className = "ledger__row" + (highlight ? " ledger__row--new" : "");
    li.dataset.id = row.id;
    li.innerHTML = rowTemplate(row);
    listEl.prepend(li);
    emptyState.hidden = true;
  }

  loadMoreBtn.addEventListener("click", () => loadSubmissions(false));

  const debouncedSearch = debounce(function () {
    currentSearch = searchInput.value.trim();
    loadSubmissions(true);
  }, 350);

  searchInput.addEventListener("input", debouncedSearch);

  // ---- Realtime subscription ------------------------------------------------
  let reconnectAttempts = 0;
  let channel = null;

  function subscribeRealtime() {
    channel = supabase
      .channel("public:submissions")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "submissions" },
        (payload) => {
          const row = payload.new;
          if (row.course_unit !== COURSE_UNIT) return;
          if (currentSearch && !row.project_title.toLowerCase().includes(currentSearch.toLowerCase())) {
            return;
          }
          prependSubmission(row, true);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "submissions" },
        (payload) => {
          const id = payload.old && payload.old.id;
          if (!id) return;
          const el = listEl.querySelector(`[data-id="${id}"]`);
          if (el) el.remove();
          loadedIds.delete(id);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "submissions" },
        (payload) => {
          const row = payload.new;
          const el = listEl.querySelector(`[data-id="${row.id}"]`);
          if (el) el.innerHTML = rowTemplate(row);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          reconnectAttempts = 0;
          hideBanner(realtimeBanner);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          showBanner(realtimeBanner, "Live updates paused — trying to reconnect…", "muted");
          scheduleReconnect();
        }
      });
  }

  function scheduleReconnect() {
    reconnectAttempts += 1;
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
    setTimeout(() => {
      if (channel) supabase.removeChannel(channel);
      subscribeRealtime();
    }, delay);
  }

  // ---- Init -------------------------------------------------------------
  loadSubmissions(true);
  subscribeRealtime();
})();