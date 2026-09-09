// ============================================================================
// admin.js — Admin dashboard logic
// ============================================================================
(function () {
  "use strict";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ---- DOM references -------------------------------------------------
  const loginView = document.getElementById("login-view");
  const dashboardView = document.getElementById("dashboard-view");

  const loginForm = document.getElementById("login-form");
  const loginEmail = document.getElementById("login-email");
  const loginPassword = document.getElementById("login-password");
  const loginBtn = document.getElementById("login-btn");
  const loginLabel = loginBtn.querySelector(".btn__label");
  const loginSpinner = loginBtn.querySelector(".btn__spinner");
  const loginBanner = document.getElementById("login-banner");

  const adminEmail = document.getElementById("admin-email");
  const logoutBtn = document.getElementById("logout-btn");
  const dashboardBanner = document.getElementById("dashboard-banner");
  const totalCount = document.getElementById("total-count");

  const adminSearch = document.getElementById("admin-search");
  const exportBtn = document.getElementById("export-btn");
  const tableBody = document.getElementById("admin-table-body");
  const emptyState = document.getElementById("admin-empty-state");
  const loadingState = document.getElementById("admin-loading-state");
  const loadMoreBtn = document.getElementById("admin-load-more-btn");

  const editModal = document.getElementById("edit-modal");
  const editForm = document.getElementById("edit-form");
  const editId = document.getElementById("edit-id");
  const editName = document.getElementById("edit-name");
  const editReg = document.getElementById("edit-reg");
  const editTitle = document.getElementById("edit-title");
  const editSaveBtn = document.getElementById("edit-save-btn");
  const editSaveLabel = editSaveBtn.querySelector(".btn__label");
  const editSaveSpinner = editSaveBtn.querySelector(".btn__spinner");
  const editBanner = document.getElementById("edit-banner");

  const deleteModal = document.getElementById("delete-modal");
  const deleteModalText = document.getElementById("delete-modal-text");
  const confirmDeleteBtn = document.getElementById("confirm-delete-btn");

  // ---- State ----------------------------------------------------------
  let currentUser = null;
  let currentSearch = "";
  let offset = 0;
  let noMoreData = false;
  let isLoading = false;
  let deletingId = null;
  let editingId = null;
  const loadedIds = new Set();

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
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch (error) {
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

  function setBusy(button, labelEl, spinnerEl, busy, busyLabel, idleLabel) {
    button.disabled = busy;
    spinnerEl.hidden = !busy;
    labelEl.textContent = busy ? busyLabel : idleLabel;
  }

  function setVisible(el, isVisible, displayValue) {
    el.hidden = !isVisible;
    el.style.display = isVisible ? (displayValue || "") : "none";
  }

  function setEditBusy(busy) {
    setBusy(editSaveBtn, editSaveLabel, editSaveSpinner, busy, "Saving…", "Save changes");
  }

  function setLoginBusy(busy) {
    setBusy(loginBtn, loginLabel, loginSpinner, busy, "Logging in…", "Log in");
  }

  async function loadAllSubmissions() {
    offset = 0;
    noMoreData = false;
    await loadSubmissions(true);
    while (!noMoreData) {
      await loadSubmissions(false);
    }
  }

  function openEditModal(row) {
    closeDeleteModal();
    editingId = row.id;
    editId.value = row.id;
    editName.value = row.student_name || "";
    editReg.value = row.registration_number || "";
    editTitle.value = row.project_title || "";
    hideBanner(editBanner);
    setVisible(editModal, true, "flex");
    document.body.style.overflow = "hidden";
    editName.focus();
  }

  function closeEditModal() {
    editingId = null;
    editForm.reset();
    hideBanner(editBanner);
    setVisible(editModal, false, "flex");
    document.body.style.overflow = "";
  }

  function openDeleteModal(row) {
    closeEditModal();
    deletingId = row.id;
    deleteModalText.textContent = `Delete submission for ${row.student_name} (${row.registration_number})? This cannot be undone.`;
    setVisible(deleteModal, true, "flex");
    document.body.style.overflow = "hidden";
  }

  function closeDeleteModal() {
    deletingId = null;
    setVisible(deleteModal, false, "flex");
    document.body.style.overflow = "";
  }

  function setAuthenticatedView(isAuthenticated) {
    setVisible(loginView, !isAuthenticated);
    setVisible(dashboardView, isAuthenticated);
  }

  function getRowDataFromElement(rowEl) {
    return {
      id: rowEl.dataset.id,
      student_name: rowEl.dataset.studentName || "",
      registration_number: rowEl.dataset.registrationNumber || "",
      project_title: rowEl.dataset.projectTitle || "",
      created_at: rowEl.dataset.createdAt || "",
    };
  }

  function createRow(row, index) {
    const tr = document.createElement("tr");
    tr.dataset.id = row.id;
    tr.dataset.studentName = row.student_name;
    tr.dataset.registrationNumber = row.registration_number;
    tr.dataset.projectTitle = row.project_title;
    tr.dataset.createdAt = row.created_at;

    tr.innerHTML = `
      <td>${index}</td>
      <td>${escapeHtml(row.registration_number)}</td>
      <td>${escapeHtml(row.student_name)}</td>
      <td>${escapeHtml(row.project_title)}</td>
      <td>${escapeHtml(formatDate(row.created_at))}</td>
      <td>
        <div class="admin-table__actions">
          <button type="button" class="btn btn--ghost btn--small" data-action="edit">Edit</button>
          <button type="button" class="btn btn--danger btn--small" data-action="delete">Delete</button>
        </div>
      </td>
    `;

    return tr;
  }

  function updateTotalCount(count, searchValue) {
    if (!searchValue) {
      totalCount.textContent = count === 1 ? "Total submissions: 1" : `Total submissions: ${count}`;
      return;
    }

    totalCount.textContent = `Showing ${count} match${count === 1 ? "" : "es"} for "${searchValue}"`;
  }

  async function loadSubmissions(reset) {
    if (isLoading) return;

    if (reset) {
      offset = 0;
      noMoreData = false;
      tableBody.innerHTML = "";
      loadedIds.clear();
    }

    if (noMoreData) return;

    isLoading = true;
    loadingState.hidden = false;
    loadMoreBtn.disabled = true;
    hideBanner(dashboardBanner);

    try {
      let query = supabase
        .from("submissions")
        .select("id, student_name, registration_number, project_title, created_at", { count: "exact" })
        .eq("course_unit", COURSE_UNIT)
        .order("created_at", { ascending: false })
        .range(offset, offset + PAGE_SIZE - 1);

      if (currentSearch) {
        const searchValue = `%${normalize(currentSearch)}%`;
        query = query.or(
          `student_name.ilike.${searchValue},registration_number.ilike.${searchValue},project_title.ilike.${searchValue},student_name_normalized.ilike.${searchValue},registration_number_normalized.ilike.${searchValue},project_title_normalized.ilike.${searchValue}`
        );
      }

      const { data, error, count } = await query;
      if (error) throw error;

      const rows = Array.isArray(data) ? data : [];
      rows.forEach((row) => {
        if (loadedIds.has(row.id)) return;
        loadedIds.add(row.id);
        tableBody.appendChild(createRow(row, loadedIds.size));
      });

      offset += rows.length;
      noMoreData = rows.length < PAGE_SIZE;
      loadMoreBtn.hidden = noMoreData;

      updateTotalCount(typeof count === "number" ? count : rows.length, currentSearch);
      emptyState.hidden = tableBody.children.length > 0;
    } catch (error) {
      showBanner(dashboardBanner, "Could not load submissions. Check your connection and try again.", "error");
    } finally {
      isLoading = false;
      loadingState.hidden = true;
      loadMoreBtn.disabled = false;
    }
  }

  function refreshRowIndexes() {
    Array.from(tableBody.children).forEach((row, index) => {
      const cell = row.children[0];
      if (cell) cell.textContent = String(index + 1);
    });
  }

  function upsertRow(rowData) {
    const existingRow = tableBody.querySelector(`[data-id="${rowData.id}"]`);
    if (existingRow) {
      existingRow.dataset.studentName = rowData.student_name;
      existingRow.dataset.registrationNumber = rowData.registration_number;
      existingRow.dataset.projectTitle = rowData.project_title;
      existingRow.dataset.createdAt = rowData.created_at;
      existingRow.children[1].textContent = rowData.registration_number;
      existingRow.children[2].textContent = rowData.student_name;
      existingRow.children[3].textContent = rowData.project_title;
      existingRow.children[4].textContent = formatDate(rowData.created_at);
      return;
    }

    if (currentSearch) {
      const combined = `${rowData.student_name} ${rowData.registration_number} ${rowData.project_title}`;
      if (normalize(combined).indexOf(normalize(currentSearch)) === -1) {
        return;
      }
    }

    loadedIds.add(rowData.id);
    tableBody.prepend(createRow(rowData, 1));
    refreshRowIndexes();
    emptyState.hidden = true;
  }

  async function handleLogin(event) {
    event.preventDefault();
    hideBanner(loginBanner);
    setLoginBusy(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginEmail.value.trim(),
        password: loginPassword.value,
      });

      if (error) throw error;

      currentUser = data.user || null;
      adminEmail.textContent = currentUser?.email || loginEmail.value.trim();
      setAuthenticatedView(true);
      await loadAllSubmissions();
      subscribeRealtime();
    } catch (error) {
      showBanner(loginBanner, error.message || "Login failed. Please check your credentials.", "error");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    try {
      await supabase.auth.signOut();
    } finally {
      currentUser = null;
      adminEmail.textContent = "";
      setAuthenticatedView(false);
      closeEditModal();
      closeDeleteModal();
    }
  }

  async function handleEditSubmit(event) {
    event.preventDefault();
    if (!editingId) return;

    hideBanner(editBanner);
    const values = {
      student_name: editName.value.trim(),
      registration_number: editReg.value.trim(),
      project_title: editTitle.value.trim(),
    };

    if (values.student_name.length < 2 || values.registration_number.length < 3 || values.project_title.length < 4) {
      showBanner(editBanner, "Please fill in all fields with valid values.", "error");
      return;
    }

    setEditBusy(true);

    try {
      const { data, error } = await supabase
        .from("submissions")
        .update(values)
        .eq("id", editingId)
        .select("id, student_name, registration_number, project_title, created_at")
        .single();

      if (error) throw error;

      upsertRow(data);
      showBanner(dashboardBanner, "Submission updated successfully.", "success");
      closeEditModal();
    } catch (error) {
      showBanner(editBanner, error.message || "Could not save changes.", "error");
    } finally {
      setEditBusy(false);
    }
  }

  async function handleDeleteConfirm() {
    if (!deletingId) return;

    confirmDeleteBtn.disabled = true;

    try {
      const { error } = await supabase.from("submissions").delete().eq("id", deletingId);
      if (error) throw error;

      const row = tableBody.querySelector(`[data-id="${deletingId}"]`);
      if (row) row.remove();
      loadedIds.delete(deletingId);
      refreshRowIndexes();
      showBanner(dashboardBanner, "Submission deleted.", "success");
      closeDeleteModal();
      emptyState.hidden = tableBody.children.length > 0;
    } catch (error) {
      showBanner(dashboardBanner, error.message || "Could not delete submission.", "error");
    } finally {
      confirmDeleteBtn.disabled = false;
    }
  }

  function exportToCsv() {
    const rows = Array.from(tableBody.querySelectorAll("tr")).map((row) => {
      const data = getRowDataFromElement(row);
      return {
        "Registration No.": data.registration_number,
        "Student name": data.student_name,
        "Project title": data.project_title,
        "Date submitted": formatDate(data.created_at),
      };
    });

    if (rows.length === 0) {
      showBanner(dashboardBanner, "There is nothing to export yet.", "muted");
      return;
    }

    const headers = ["Registration No.", "Student name", "Project title", "Date submitted"];
    const csvLines = [
      headers.join(","),
      ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
    ];

    const blob = new Blob(["\uFEFF" + csvLines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `course-project-submissions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  const debouncedSearch = debounce(function () {
    currentSearch = adminSearch.value.trim();
    loadAllSubmissions();
  }, 300);

  function handleTableClick(event) {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const rowEl = event.target.closest("tr[data-id]");
    if (!rowEl) return;

    const row = {
      id: rowEl.dataset.id,
      student_name: rowEl.dataset.studentName || "",
      registration_number: rowEl.dataset.registrationNumber || "",
      project_title: rowEl.dataset.projectTitle || "",
      created_at: rowEl.dataset.createdAt || "",
    };

    if (button.dataset.action === "edit") {
      openEditModal(row);
      return;
    }

    if (button.dataset.action === "delete") {
      openDeleteModal(row);
    }
  }

  // ---- Realtime subscription -----------------------------------------
  let channel = null;
  function subscribeRealtime() {
    if (channel) {
      supabase.removeChannel(channel);
    }

    channel = supabase
      .channel("public:submissions-admin")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "submissions" },
        (payload) => {
          const row = payload.new;
          if (row.course_unit !== COURSE_UNIT) return;
          upsertRow(row);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "submissions" },
        (payload) => {
          const row = payload.new;
          if (row.course_unit !== COURSE_UNIT) return;
          upsertRow(row);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "submissions" },
        (payload) => {
          const row = payload.old;
          if (!row || row.course_unit !== COURSE_UNIT) return;
          const existingRow = tableBody.querySelector(`[data-id="${row.id}"]`);
          if (existingRow) existingRow.remove();
          loadedIds.delete(row.id);
          refreshRowIndexes();
          emptyState.hidden = tableBody.children.length > 0;
        }
      )
      .subscribe();
  }

  // ---- Init -----------------------------------------------------------
  loginForm.addEventListener("submit", handleLogin);
  logoutBtn.addEventListener("click", handleLogout);
  adminSearch.addEventListener("input", debouncedSearch);
  loadMoreBtn.addEventListener("click", () => loadSubmissions(false));
  exportBtn.addEventListener("click", exportToCsv);
  tableBody.addEventListener("click", handleTableClick);
  editForm.addEventListener("submit", handleEditSubmit);
  confirmDeleteBtn.addEventListener("click", handleDeleteConfirm);

  editModal.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", closeEditModal);
  });

  deleteModal.querySelectorAll("[data-close-delete-modal]").forEach((button) => {
    button.addEventListener("click", closeDeleteModal);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (!editModal.hidden) closeEditModal();
      if (!deleteModal.hidden) closeDeleteModal();
    }
  });

  supabase.auth.getSession().then(({ data }) => {
    const session = data?.session || null;
    currentUser = session?.user || null;

    if (currentUser) {
      adminEmail.textContent = currentUser.email || "";
      setAuthenticatedView(true);
      loadAllSubmissions();
      subscribeRealtime();
    } else {
      setAuthenticatedView(false);
    }
  });

  setVisible(editModal, false, "flex");
  setVisible(deleteModal, false, "flex");
})();
