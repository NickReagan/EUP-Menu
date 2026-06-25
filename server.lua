local KVP_KEY = "eup_dynamic"
local dynData  = { departments = {} }

-- ── KVP ──────────────────────────────────────────────────────────────────────

local function saveKVP()
    SetResourceKvp(KVP_KEY, json.encode(dynData))
end

local function loadKVP()
    local raw = GetResourceKvpString(KVP_KEY)
    if not raw or raw == "" then
        print("[EUP] No saved data found, starting fresh.")
        return
    end
    local ok, decoded = pcall(json.decode, raw)
    if ok and type(decoded) == "table" then
        dynData = decoded
        local count = #(dynData.departments or {})
        print(("[EUP] Loaded %d department(s) from KVP."):format(count))
    else
        print("[EUP] WARNING: KVP data is corrupt, starting fresh.")
    end
end

-- ── Broadcast / notify ────────────────────────────────────────────────────────

local function broadcast()
    TriggerClientEvent("eup:receiveData", -1, dynData)
end

local function sendTo(src)
    TriggerClientEvent("eup:receiveData", src, dynData)
end

local function notify(src, msg)
    TriggerClientEvent("eup:notify", src, msg)
end

-- ── Discord webhook logging ───────────────────────────────────────────────────

local function logWebhook(src, action, description)
    if not config.webhook or config.webhook.url == "" then return end
    local payload = json.encode({
        username = config.webhook.username or "EUP Menu",
        embeds = {{
            title       = action,
            description = description,
            color       = 3447003,
            footer      = { text = "Player: " .. (GetPlayerName(src) or "Unknown") .. "  |  ID: " .. tostring(src) },
            timestamp   = os.date("!%Y-%m-%dT%H:%M:%SZ"),
        }}
    })
    PerformHttpRequest(config.webhook.url, function() end, "POST", payload, {["Content-Type"] = "application/json"})
end

-- ── ACE helpers ───────────────────────────────────────────────────────────────

local function hasAce(src, ace)
    if not ace then return false end
    return IsPlayerAceAllowed(src, ace)
end

-- Returns true if player has the master adminAce OR the specific groupAce.
local function checkGroupAce(src, groupAce)
    if hasAce(src, config.permissions.adminAce) then return true end
    if groupAce and hasAce(src, groupAce) then return true end
    return false
end

-- Returns true if player can manage subs or uniforms for a specific department.
-- Checks: adminAce → global group ACE → per-dept ACE from config.departmentPerms.
local function checkDeptAce(src, deptName, aceType)
    if hasAce(src, config.permissions.adminAce) then return true end
    local globalAce = (aceType == "sub") and config.permissions.subManageAce
                   or config.permissions.uniformManageAce
    if hasAce(src, globalAce) then return true end
    local dp = config.departmentPerms and config.departmentPerms[deptName]
    if dp then
        local deptAce = (aceType == "sub") and dp.subManageAce or dp.uniformManageAce
        if hasAce(src, deptAce) then return true end
    end
    return false
end

-- ── Lookup helpers ─────────────────────────────────────────────────────────────

local function findDept(name)
    for i, d in ipairs(dynData.departments) do
        if d.name:lower() == name:lower() then return i, d end
    end
    return nil, nil
end

local function findSub(dept, name)
    for i, s in ipairs(dept.submenus or {}) do
        if s.name:lower() == name:lower() then return i, s end
    end
    return nil, nil
end

local function findUniform(sub, name)
    for i, u in ipairs(sub.uniforms or {}) do
        if u.name:lower() == name:lower() then return i, u end
    end
    return nil, nil
end

-- ── Resource start ────────────────────────────────────────────────────────────

AddEventHandler("onResourceStart", function(res)
    if res == GetCurrentResourceName() then loadKVP() end
end)

-- ── Data sync ─────────────────────────────────────────────────────────────────

RegisterNetEvent("eup:requestData")
AddEventHandler("eup:requestData", function()
    sendTo(source)
end)

-- ── ACE check callback (client cannot call IsPlayerAceAllowed) ────────────────

RegisterNetEvent("eup:checkAce")
AddEventHandler("eup:checkAce", function(ace, cbId)
    local allowed = ace and IsPlayerAceAllowed(source, ace) or false
    TriggerClientEvent("eup:aceResult", source, cbId, allowed)
end)

-- ── Dept: Create ──────────────────────────────────────────────────────────────

RegisterNetEvent("eup:createDept")
AddEventHandler("eup:createDept", function(name)
    local src = source
    if not checkGroupAce(src, config.permissions.deptManageAce) then
        notify(src, "~r~You do not have permission to manage departments.")
        return
    end
    name = tostring(name):gsub("^%s+", ""):gsub("%s+$", ""):sub(1, 64)
    if name == "" then return end
    if findDept(name) then
        notify(src, "~r~A department named '" .. name .. "' already exists.")
        return
    end
    table.insert(dynData.departments, { name = name, submenus = {} })
    saveKVP()
    broadcast()
    notify(src, "~g~Department created: " .. name)
    logWebhook(src, "Department Created", "**" .. name .. "**")
end)

-- ── Dept: Delete ──────────────────────────────────────────────────────────────

RegisterNetEvent("eup:deleteDept")
AddEventHandler("eup:deleteDept", function(name)
    local src = source
    if not checkGroupAce(src, config.permissions.deptManageAce) then
        notify(src, "~r~You do not have permission to manage departments.")
        return
    end
    local i = findDept(name)
    if not i then notify(src, "~r~Department not found: " .. tostring(name)); return end
    table.remove(dynData.departments, i)
    saveKVP()
    broadcast()
    notify(src, "~y~Department deleted: " .. name)
    logWebhook(src, "Department Deleted", "**" .. name .. "**")
end)

-- ── Sub-Category: Create ──────────────────────────────────────────────────────

RegisterNetEvent("eup:createSub")
AddEventHandler("eup:createSub", function(deptName, subName)
    local src = source
    if not checkDeptAce(src, deptName, "sub") then
        notify(src, "~r~You do not have permission to manage sub-categories.")
        return
    end
    local _, dept = findDept(deptName)
    if not dept then notify(src, "~r~Department not found: " .. tostring(deptName)); return end
    subName = tostring(subName):gsub("^%s+", ""):gsub("%s+$", ""):sub(1, 64)
    if subName == "" then return end
    if findSub(dept, subName) then
        notify(src, "~r~Sub-category '" .. subName .. "' already exists in " .. deptName)
        return
    end
    table.insert(dept.submenus, { name = subName, uniforms = {} })
    saveKVP()
    broadcast()
    notify(src, "~g~Sub-category created: " .. subName)
    logWebhook(src, "Sub-Category Created", "**" .. subName .. "** in " .. deptName)
end)

-- ── Sub-Category: Delete (uniforms migrate to Uncategorized) ─────────────────

RegisterNetEvent("eup:deleteSub")
AddEventHandler("eup:deleteSub", function(deptName, subName)
    local src = source
    if not checkDeptAce(src, deptName, "sub") then
        notify(src, "~r~You do not have permission to manage sub-categories.")
        return
    end
    local _, dept = findDept(deptName)
    if not dept then notify(src, "~r~Department not found."); return end
    local si, sub = findSub(dept, subName)
    if not si or not sub then notify(src, "~r~Sub-category not found."); return end

    if #sub.uniforms > 0 then
        local _, uncatSub = findSub(dept, "Uncategorized")
        if not uncatSub then
            uncatSub = { name = "Uncategorized", uniforms = {} }
            table.insert(dept.submenus, uncatSub)
        end
        for _, u in ipairs(sub.uniforms) do
            table.insert(uncatSub.uniforms, u)
        end
    end

    table.remove(dept.submenus, si)
    saveKVP()
    broadcast()
    notify(src, "~y~Sub-category deleted. Uniforms moved to Uncategorized.")
    logWebhook(src, "Sub-Category Deleted", "**" .. subName .. "** from " .. deptName)
end)

-- ── Uniform: Save / Override ──────────────────────────────────────────────────

RegisterNetEvent("eup:saveUniform")
AddEventHandler("eup:saveUniform", function(payload)
    local src = source
    if type(payload) ~= "table" then return end
    local deptName, subName, name = payload.dept, payload.subMenu, payload.name
    local pedModel, props, components = payload.pedModel, payload.props, payload.components
    if not (deptName and subName and name and pedModel and props and components) then return end
    if pedModel ~= "mp_m_freemode_01" and pedModel ~= "mp_f_freemode_01" then return end

    if not checkDeptAce(src, deptName, "uniform") then
        notify(src, "~r~You do not have permission to manage uniforms.")
        return
    end

    local _, dept = findDept(deptName)
    if not dept then notify(src, "~r~Department not found."); return end
    local _, sub = findSub(dept, subName)
    if not sub then notify(src, "~r~Sub-category not found."); return end

    local uniform = { name = name, pedModel = pedModel, props = props, components = components }
    local i = findUniform(sub, name)
    local desc = "**" .. name .. "** → " .. deptName .. " / " .. subName .. " (" .. pedModel .. ")"
    if i then
        sub.uniforms[i] = uniform
        saveKVP(); broadcast()
        notify(src, "~y~Uniform overridden: " .. name)
        logWebhook(src, "Uniform Overridden", desc)
    else
        table.insert(sub.uniforms, uniform)
        saveKVP(); broadcast()
        notify(src, "~g~Uniform saved: " .. name)
        logWebhook(src, "Uniform Saved", desc)
    end
end)

-- ── Uniform: Rename ───────────────────────────────────────────────────────────

RegisterNetEvent("eup:renameUniform")
AddEventHandler("eup:renameUniform", function(deptName, subName, oldName, newName)
    local src = source
    if not checkDeptAce(src, deptName, "uniform") then
        notify(src, "~r~You do not have permission to manage uniforms.")
        return
    end
    local _, dept = findDept(deptName)
    if not dept then notify(src, "~r~Uniform not found."); return end
    local _, sub = findSub(dept, subName)
    if not sub then notify(src, "~r~Uniform not found."); return end
    local i = findUniform(sub, oldName)
    if not i then notify(src, "~r~Uniform not found."); return end
    newName = tostring(newName):gsub("^%s+", ""):gsub("%s+$", ""):sub(1, 64)
    if newName == "" then return end
    sub.uniforms[i].name = newName
    saveKVP(); broadcast()
    notify(src, "~g~Uniform renamed to: " .. newName)
    logWebhook(src, "Uniform Renamed", "**" .. oldName .. "** → **" .. newName .. "** in " .. deptName .. " / " .. subName)
end)

-- ── Uniform: Move ─────────────────────────────────────────────────────────────

RegisterNetEvent("eup:moveUniform")
AddEventHandler("eup:moveUniform", function(fromDept, fromSub, uName, toDept, toSub)
    local src = source
    if not checkDeptAce(src, fromDept, "uniform") or not checkDeptAce(src, toDept, "uniform") then
        notify(src, "~r~You do not have permission to manage uniforms.")
        return
    end
    local _, deptA = findDept(fromDept)
    if not deptA then notify(src, "~r~Uniform not found."); return end
    local _, subA = findSub(deptA, fromSub)
    if not subA then notify(src, "~r~Uniform not found."); return end
    local i, u = findUniform(subA, uName)
    if not i then notify(src, "~r~Uniform not found."); return end

    local _, deptB = findDept(toDept)
    if not deptB then notify(src, "~r~Destination sub-category not found."); return end
    local _, subB = findSub(deptB, toSub)
    if not subB then notify(src, "~r~Destination sub-category not found."); return end

    table.remove(subA.uniforms, i)
    table.insert(subB.uniforms, u)
    saveKVP(); broadcast()
    notify(src, "~g~Uniform moved to " .. toDept .. " / " .. toSub)
    logWebhook(src, "Uniform Moved", "**" .. uName .. "** : " .. fromDept .. "/" .. fromSub .. " → " .. toDept .. "/" .. toSub)
end)

-- ── Uniform: Delete ───────────────────────────────────────────────────────────

RegisterNetEvent("eup:deleteUniform")
AddEventHandler("eup:deleteUniform", function(deptName, subName, name)
    local src = source
    if not checkDeptAce(src, deptName, "uniform") then
        notify(src, "~r~You do not have permission to manage uniforms.")
        return
    end
    local _, dept = findDept(deptName)
    if not dept then notify(src, "~r~Uniform not found."); return end
    local _, sub = findSub(dept, subName)
    if not sub then notify(src, "~r~Uniform not found."); return end
    local i = findUniform(sub, name)
    if not i then notify(src, "~r~Uniform not found."); return end
    table.remove(sub.uniforms, i)
    saveKVP(); broadcast()
    notify(src, "~y~Uniform deleted: " .. name)
    logWebhook(src, "Uniform Deleted", "**" .. name .. "** from " .. deptName .. " / " .. subName)
end)

-- ── Dept: Set Description ─────────────────────────────────────────────────────

RegisterNetEvent("eup:setDeptDesc")
AddEventHandler("eup:setDeptDesc", function(deptName, description)
    local src = source
    if not checkGroupAce(src, config.permissions.deptManageAce) then
        notify(src, "~r~You do not have permission to manage departments.")
        return
    end
    local _, dept = findDept(deptName)
    if not dept then notify(src, "~r~Department not found."); return end
    description = tostring(description or ""):sub(1, 128)
    dept.description = description
    saveKVP(); broadcast()
    notify(src, "~g~Department description updated.")
    logWebhook(src, "Department Description Updated", "**" .. deptName .. "**: " .. description)
end)

-- ── Sub-Category: Set Description ─────────────────────────────────────────────

RegisterNetEvent("eup:setSubDesc")
AddEventHandler("eup:setSubDesc", function(deptName, subName, description)
    local src = source
    if not checkDeptAce(src, deptName, "sub") then
        notify(src, "~r~You do not have permission to manage sub-categories.")
        return
    end
    local _, dept = findDept(deptName)
    if not dept then notify(src, "~r~Department not found."); return end
    local _, sub = findSub(dept, subName)
    if not sub then notify(src, "~r~Sub-category not found."); return end
    description = tostring(description or ""):sub(1, 128)
    sub.description = description
    saveKVP(); broadcast()
    notify(src, "~g~Sub-category description updated.")
    logWebhook(src, "Sub-Category Description Updated", "**" .. subName .. "** in " .. deptName .. ": " .. description)
end)

-- ── Dept: Set Abbreviation ───────────────────────────────────────────────────

RegisterNetEvent("eup:setDeptAbbv")
AddEventHandler("eup:setDeptAbbv", function(deptName, abbv)
    local src = source
    if not checkGroupAce(src, config.permissions.deptManageAce) then
        notify(src, "~r~You do not have permission to manage departments.")
        return
    end
    local _, dept = findDept(deptName)
    if not dept then notify(src, "~r~Department not found."); return end
    abbv = tostring(abbv or ""):gsub("^%s+", ""):gsub("%s+$", ""):sub(1, 16)
    dept.abbreviation = abbv
    saveKVP(); broadcast()
    notify(src, "~g~Department abbreviation updated.")
    logWebhook(src, "Department Abbreviation Updated", "**" .. deptName .. "**: " .. abbv)
end)

-- ── Console: wipe all KVP data ────────────────────────────────────────────────

RegisterCommand("eup_resetkvp", function(src)
    if src ~= 0 then return end  -- console only
    SetResourceKvp(KVP_KEY, "")
    dynData = { departments = {} }
    broadcast()
    print("[EUP] KVP reset. All dynamic data has been cleared.")
end, true)
