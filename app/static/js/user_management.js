// user_management.js
// 使用者管理前端邏輯

let allUsers = [];

// 載入使用者列表
async function loadUsers() {
    try {
        const search = document.getElementById('search-input').value;
        const role = document.getElementById('role-filter').value;
        const status = document.getElementById('status-filter').value;

        const params = new URLSearchParams();
        if (search) params.append('search', search);
        if (role) params.append('role', role);
        if (status) params.append('status', status);

        const response = await fetch(`/api/users?${params}`);
        const data = await response.json();

        if (data.success) {
            allUsers = data.users;
            renderUserTable(allUsers);
            updateStats(allUsers);
        } else {
            showError('載入使用者失敗: ' + data.error);
        }
    } catch (error) {
        console.error('載入使用者失敗:', error);
        showError('載入使用者失敗');
    }
}

// 渲染使用者表格
function renderUserTable(users) {
    const tbody = document.getElementById('user-table-body');

    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-message">沒有找到使用者</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(user => `
        <tr>
            <td>${escapeHtml(user.id)}</td>
            <td>${escapeHtml(user.username)}</td>
            <td>${escapeHtml(user.full_name || '-')}</td>
            <td>${escapeHtml(user.department || '-')}</td>
            <td>${getRoleBadge(user.role)}</td>
            <td>${getStatusBadge(user.is_active)}</td>
            <td class="action-buttons">
                <button onclick="editUser('${user.id}')" class="outline">編輯</button>
                <button onclick="toggleUserActive('${user.id}')" class="outline ${user.is_active ? 'secondary' : 'contrast'}">
                    ${user.is_active ? '停用' : '啟用'}
                </button>
                <button onclick="showResetPassword('${user.id}', '${escapeHtml(user.full_name || user.username)}')" class="outline">
                    重設密碼
                </button>
            </td>
        </tr>
    `).join('');
}

// 更新統計數據
function updateStats(users) {
    const total = users.length;
    const active = users.filter(u => u.is_active).length;
    const inactive = total - active;

    document.getElementById('stat-total').textContent = total;
    document.getElementById('stat-active').textContent = active;
    document.getElementById('stat-inactive').textContent = inactive;
}

// 取得角色標籤
function getRoleBadge(role) {
    const badges = {
        'admin': '<span class="badge badge-admin">管理員</span>',
        'buyer': '<span class="badge badge-buyer">採購人員</span>',
        'viewer': '<span class="badge badge-viewer">檢視者</span>'
    };
    return badges[role] || '<span class="badge">' + escapeHtml(role) + '</span>';
}

// 取得狀態標籤
function getStatusBadge(isActive) {
    return isActive
        ? '<span class="badge badge-active">已啟用</span>'
        : '<span class="badge badge-inactive">已停用</span>';
}

// 顯示新增使用者彈窗
function showAddUser() {
    document.getElementById('modal-title').textContent = '新增使用者';
    document.getElementById('edit-mode').value = 'create';
    document.getElementById('original-id').value = '';
    document.getElementById('user-form').reset();
    document.getElementById('user-id').disabled = false;
    document.getElementById('password-group').style.display = 'block';
    document.getElementById('user-password').required = true;
    document.getElementById('user-modal').classList.add('active');
}

// 編輯使用者
async function editUser(userId) {
    try {
        const response = await fetch(`/api/users/${userId}`);
        const data = await response.json();

        if (data.success) {
            const user = data.user;
            document.getElementById('modal-title').textContent = '編輯使用者';
            document.getElementById('edit-mode').value = 'edit';
            document.getElementById('original-id').value = user.id;
            document.getElementById('user-id').value = user.id;
            document.getElementById('user-id').disabled = true;
            document.getElementById('user-username').value = user.username;
            document.getElementById('user-fullname').value = user.full_name || '';
            document.getElementById('user-email').value = user.email || '';
            document.getElementById('user-department').value = user.department || '';
            document.getElementById('user-role').value = user.role;

            // 編輯時不需要密碼
            document.getElementById('password-group').style.display = 'none';
            document.getElementById('user-password').required = false;

            document.getElementById('user-modal').classList.add('active');
        } else {
            showError('載入使用者資料失敗: ' + data.error);
        }
    } catch (error) {
        console.error('載入使用者資料失敗:', error);
        showError('載入使用者資料失敗');
    }
}

// 關閉彈窗
function closeModal() {
    document.getElementById('user-modal').classList.remove('active');
}

// 儲存使用者
async function saveUser(event) {
    event.preventDefault();

    const editMode = document.getElementById('edit-mode').value;
    const userId = document.getElementById('user-id').value;

    const userData = {
        id: userId,
        username: document.getElementById('user-username').value,
        full_name: document.getElementById('user-fullname').value,
        email: document.getElementById('user-email').value,
        department: document.getElementById('user-department').value,
        role: document.getElementById('user-role').value
    };

    if (editMode === 'create') {
        userData.password = document.getElementById('user-password').value;
    }

    try {
        let response;
        if (editMode === 'create') {
            response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
        } else {
            const originalId = document.getElementById('original-id').value;
            response = await fetch(`/api/users/${originalId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(userData)
            });
        }

        const data = await response.json();

        if (data.success) {
            closeModal();
            loadUsers();
            showSuccess(data.message);
        } else {
            showError(data.error);
        }
    } catch (error) {
        console.error('儲存使用者失敗:', error);
        showError('儲存使用者失敗');
    }
}

// 切換使用者狀態
async function toggleUserActive(userId) {
    const user = allUsers.find(u => u.id === userId);
    const action = user?.is_active ? '停用' : '啟用';

    if (!confirm(`確定要${action}此使用者嗎？`)) {
        return;
    }

    try {
        const response = await fetch(`/api/users/${userId}/toggle-active`, {
            method: 'POST'
        });

        const data = await response.json();

        if (data.success) {
            loadUsers();
            showSuccess(data.message);
        } else {
            showError(data.error);
        }
    } catch (error) {
        console.error('切換使用者狀態失敗:', error);
        showError('操作失敗');
    }
}

// 顯示重設密碼彈窗
function showResetPassword(userId, userName) {
    document.getElementById('reset-user-id').value = userId;
    document.getElementById('reset-user-name').textContent = userName;
    document.getElementById('password-form').reset();
    document.getElementById('password-modal').classList.add('active');
}

// 關閉重設密碼彈窗
function closePasswordModal() {
    document.getElementById('password-modal').classList.remove('active');
}

// 重設密碼
async function resetPassword(event) {
    event.preventDefault();

    const userId = document.getElementById('reset-user-id').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;

    if (newPassword !== confirmPassword) {
        showError('兩次輸入的密碼不一致');
        return;
    }

    try {
        const response = await fetch(`/api/users/${userId}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_password: newPassword })
        });

        const data = await response.json();

        if (data.success) {
            closePasswordModal();
            showSuccess(data.message);
        } else {
            showError(data.error);
        }
    } catch (error) {
        console.error('重設密碼失敗:', error);
        showError('重設密碼失敗');
    }
}

// HTML 轉義
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 顯示成功訊息
function showSuccess(message) {
    alert('✅ ' + message);
}

// 顯示錯誤訊息
function showError(message) {
    alert('❌ ' + message);
}

// 防抖函式
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// 初始化
document.addEventListener('DOMContentLoaded', function () {
    // 載入使用者列表
    loadUsers();

    // 綁定事件
    document.getElementById('btn-add-user').addEventListener('click', showAddUser);
    document.getElementById('user-form').addEventListener('submit', saveUser);
    document.getElementById('password-form').addEventListener('submit', resetPassword);

    // 搜尋和篩選 (防抖)
    const debouncedLoad = debounce(loadUsers, 300);
    document.getElementById('search-input').addEventListener('input', debouncedLoad);
    document.getElementById('role-filter').addEventListener('change', loadUsers);
    document.getElementById('status-filter').addEventListener('change', loadUsers);

    // 點擊背景關閉彈窗
    document.getElementById('user-modal').addEventListener('click', function (e) {
        if (e.target === this) closeModal();
    });
    document.getElementById('password-modal').addEventListener('click', function (e) {
        if (e.target === this) closePasswordModal();
    });
});
