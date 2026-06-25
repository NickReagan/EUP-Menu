-- ── State ─────────────────────────────────────────────────────────────

local dynData     = { departments = {} }
local isAdmin     = false
local menuAllowed = false
local menuOpen    = false
local cursorMode  = false  -- true only when an admin view with text inputs is active

local aceCache   = {}
local acePending = {}
local aceCounter = 0

local MALE_MODEL   = GetHashKey("mp_m_freemode_01")
local FEMALE_MODEL = GetHashKey("mp_f_freemode_01")

-- ── Core helpers ──────────────────────────────────────────────────────

function alert(msg)
    SetTextComponentFormat("STRING")
    AddTextComponentString(msg)
    DisplayHelpTextFromStringLabel(0, 0, 1, -1)
end

local function checkAce(ace, cb)
    if not ace then cb(true); return end
    if aceCache[ace] ~= nil then cb(aceCache[ace]); return end
    aceCounter = aceCounter + 1
    local id = aceCounter
    acePending[id] = function(ok)
        aceCache[ace] = ok
        cb(ok)
    end
    TriggerServerEvent("eup:checkAce", ace, id)
end

RegisterNetEvent("eup:aceResult")
AddEventHandler("eup:aceResult", function(id, ok)
    if config.debug then print("[EUP DEBUG] eup:aceResult | id=" .. tostring(id) .. " ok=" .. tostring(ok)) end
    if acePending[id] then
        acePending[id](ok)
        acePending[id] = nil
    end
end)

-- ── Uniform application ───────────────────────────────────────────────

function setEUP(uniform)
    local ped = PlayerPedId()
    local targetModel = uniform.pedModel or "mp_m_freemode_01"
    if GetEntityModel(ped) ~= GetHashKey(targetModel) then
        RequestModel(targetModel)
        while not HasModelLoaded(targetModel) do
            Citizen.Wait(0)
        end
        SetPlayerModel(PlayerId(), targetModel)
        SetModelAsNoLongerNeeded(targetModel)
    end
    ped = PlayerPedId()
    for _, c in ipairs(uniform.components) do
        SetPedComponentVariation(ped, c[1], c[2], c[3], 0)
    end
    for _, p in ipairs(uniform.props) do
        if p[2] == 0 then
            ClearPedProp(ped, p[1])
        else
            SetPedPropIndex(ped, p[1], p[2] - 1, p[3], true)
        end
    end
end

-- ── Outfit capture ────────────────────────────────────────────────────

local function captureCurrentOutfit()
    local ped   = PlayerPedId()
    local model = GetEntityModel(ped)
    local pedModel

    if model == MALE_MODEL then
        pedModel = "mp_m_freemode_01"
    elseif model == FEMALE_MODEL then
        pedModel = "mp_f_freemode_01"
    else
        alert("~r~Error: You must be in a Male or Female freemode ped to save a uniform.")
        return nil
    end

    local cp = config.captureProps
    local props = {}
    local propSlots = {
        {slot = 0, key = "hats"},
        {slot = 1, key = "glasses"},
        {slot = 2, key = "ears"},
        {slot = 6, key = "watches"},
        {slot = 7, key = "bracelets"},
    }
    for _, p in ipairs(propSlots) do
        if cp[p.key] then
            table.insert(props, {p.slot, GetPedPropIndex(ped, p.slot) + 1, GetPedPropTextureIndex(ped, p.slot)})
        end
    end

    local components = {}
    for _, slot in ipairs({1, 3, 4, 5, 6, 7, 8, 9, 10, 11}) do
        table.insert(components, {
            slot,
            GetPedDrawableVariation(ped, slot),
            GetPedTextureVariation(ped, slot),
        })
    end

    return pedModel, props, components
end

-- ── NUI open / close ──────────────────────────────────────────────────

local function openMenu()
    if not menuAllowed then return end
    if menuOpen then return end
    menuOpen = true
    cursorMode = false
    -- NUI gets keyboard so JS keydown fires, but no cursor.
    -- SetNuiFocusKeepInput lets the game still process WASD/camera/interactions.
    SetNuiFocus(true, false)
    SetNuiFocusKeepInput(true)
    SendNUIMessage({ action = "open", data = dynData, isAdmin = isAdmin })
end

local function closeMenu()
    if not menuOpen then return end
    menuOpen = false
    cursorMode = false
    SetNuiFocusKeepInput(false)
    SetNuiFocus(false, false)
    SendNUIMessage({ action = "close" })
end

-- Called by JS when entering/leaving a view that needs cursor (admin) or not (player)
RegisterNUICallback("setFocusMode", function(data, cb)
    if menuOpen then
        cursorMode = data.cursor == true
        if cursorMode then
            SetNuiFocusKeepInput(false)
            SetNuiFocus(true, true)   -- cursor visible, full NUI capture
        else
            SetNuiFocus(true, false)  -- keyboard only, no cursor
            SetNuiFocusKeepInput(true) -- game keeps WASD/camera
        end
    end
    cb({})
end)

-- ── NUI callbacks ─────────────────────────────────────────────────────

RegisterNUICallback("closeMenu", function(_, cb)
    closeMenu()
    cb({})
end)

RegisterNUICallback("applyUniform", function(data, cb)
    if data and data.uniform then
        setEUP(data.uniform)
    end
    cb({})
end)

-- Dept management
RegisterNUICallback("createDept", function(data, cb)
    if data.name then TriggerServerEvent("eup:createDept", data.name) end
    cb({})
end)

RegisterNUICallback("setDeptDesc", function(data, cb)
    TriggerServerEvent("eup:setDeptDesc", data.dept, data.desc or "")
    cb({})
end)

RegisterNUICallback("setDeptAbbv", function(data, cb)
    TriggerServerEvent("eup:setDeptAbbv", data.dept, data.abbv or "")
    cb({})
end)

RegisterNUICallback("deleteDept", function(data, cb)
    TriggerServerEvent("eup:deleteDept", data.dept)
    cb({})
end)

-- Sub-category management
RegisterNUICallback("createSub", function(data, cb)
    if data.sub then TriggerServerEvent("eup:createSub", data.dept, data.sub) end
    cb({})
end)

RegisterNUICallback("setSubDesc", function(data, cb)
    TriggerServerEvent("eup:setSubDesc", data.dept, data.sub, data.desc or "")
    cb({})
end)

RegisterNUICallback("deleteSub", function(data, cb)
    TriggerServerEvent("eup:deleteSub", data.dept, data.sub)
    cb({})
end)

-- Uniform management
RegisterNUICallback("saveUniform", function(data, cb)
    local pedModel, props, components = captureCurrentOutfit()
    if not pedModel then cb({}); return end
    TriggerServerEvent("eup:saveUniform", {
        dept       = data.dept,
        subMenu    = data.sub,
        name       = data.name,
        pedModel   = pedModel,
        props      = props,
        components = components,
    })
    cb({})
end)

RegisterNUICallback("overrideUniform", function(data, cb)
    local pedModel, props, components = captureCurrentOutfit()
    if not pedModel then cb({}); return end
    TriggerServerEvent("eup:saveUniform", {
        dept       = data.dept,
        subMenu    = data.sub,
        name       = data.uName,
        pedModel   = pedModel,
        props      = props,
        components = components,
    })
    cb({})
end)

RegisterNUICallback("renameUniform", function(data, cb)
    TriggerServerEvent("eup:renameUniform", data.dept, data.sub, data.oldName, data.newName)
    cb({})
end)

RegisterNUICallback("moveUniform", function(data, cb)
    TriggerServerEvent("eup:moveUniform", data.fromDept, data.fromSub, data.uName, data.toDept, data.toSub)
    cb({})
end)

RegisterNUICallback("deleteUniform", function(data, cb)
    TriggerServerEvent("eup:deleteUniform", data.dept, data.sub, data.uName)
    cb({})
end)

-- ── Server data events ────────────────────────────────────────────────

RegisterNetEvent("eup:receiveData")
AddEventHandler("eup:receiveData", function(data)
    if config.debug then print("[EUP DEBUG] eup:receiveData | depts=" .. #(data.departments or {})) end
    dynData = data
    SendNUIMessage({ action = "dataUpdate", data = dynData })
end)

RegisterNetEvent("eup:notify")
AddEventHandler("eup:notify", function(msg)
    alert(msg)
    SendNUIMessage({ action = "notify", message = msg })
end)

-- ── Open command ──────────────────────────────────────────────────────

if config.enableOpenCommand then
    TriggerEvent("chat:addSuggestion", "/" .. config.openCommand, "Open EUP Menu")
    RegisterCommand(config.openCommand, function()
        if not menuAllowed then
            TriggerEvent("chat:addMessage", {color = {255, 0, 0}, args = {"EUP", "You do not have permission to use this menu."}})
            return
        end
        if menuOpen then
            closeMenu()
        else
            openMenu()
        end
    end, false)
end

-- ── Game loop ─────────────────────────────────────────────────────────

Citizen.CreateThread(function()
    while true do
        Citizen.Wait(0)
        if config.enableAccessCircles and menuAllowed then
            for i = 1, #config.accessCircles do
                local circle = config.accessCircles[i]
                DrawMarker(1, circle.x, circle.y, circle.z, 0, 0, 0, 0, 0, 0, 1.001, 1.0001, 0.5001, 0, 0, 255, 200, false, false, 2, false, nil, nil, false)
                if #(GetEntityCoords(PlayerPedId()) - vector3(circle.x, circle.y, circle.z)) <= 1.2 then
                    if not menuOpen then
                        alert("Press ~INPUT_CONTEXT~ to open the EUP Menu.")
                        if IsControlJustPressed(1, 51) then
                            openMenu()
                        end
                    end
                end
            end
        end
    end
end)

-- ── Block GTA from acting on menu nav keys while menu is open ─────────
-- JS handles the actual navigation via keydown events (SetNuiFocusKeepInput
-- lets NUI receive keyboard while the game still processes movement).
-- We still need to consume the GTA frontend controls every frame so that
-- GTA's own HUD/phone doesn't react to the same arrow/accept/cancel keys.

Citizen.CreateThread(function()
    while true do
        Citizen.Wait(0)
        if menuOpen and not cursorMode then
            DisableControlAction(0, 172, true) -- UP
            DisableControlAction(0, 173, true) -- DOWN
            DisableControlAction(0, 174, true) -- LEFT
            DisableControlAction(0, 175, true) -- RIGHT
            DisableControlAction(0, 176, true) -- ACCEPT
            DisableControlAction(0, 177, true) -- CANCEL/BACK
        end
    end
end)

-- ── Debug: print current outfit ───────────────────────────────────────

RegisterCommand("geteup", function()
    local ped = PlayerPedId()
    local props = "props = {\n"
        .. "    {0, " .. GetPedPropIndex(ped, 0) + 1 .. ", " .. GetPedPropTextureIndex(ped, 0) .. "}, -- Hats\n"
        .. "    {1, " .. GetPedPropIndex(ped, 1) + 1 .. ", " .. GetPedPropTextureIndex(ped, 1) .. "}, -- Glasses\n"
        .. "    {6, " .. GetPedPropIndex(ped, 6) + 1 .. ", " .. GetPedPropTextureIndex(ped, 6) .. "}  -- Watch\n"
        .. "},"
    local components = "components = {\n"
        .. "    {1,  " .. GetPedDrawableVariation(ped, 1)  .. ", " .. GetPedTextureVariation(ped, 1)  .. "}, -- Mask\n"
        .. "    {3,  " .. GetPedDrawableVariation(ped, 3)  .. ", " .. GetPedTextureVariation(ped, 3)  .. "}, -- Upper body\n"
        .. "    {4,  " .. GetPedDrawableVariation(ped, 4)  .. ", " .. GetPedTextureVariation(ped, 4)  .. "}, -- Legs\n"
        .. "    {5,  " .. GetPedDrawableVariation(ped, 5)  .. ", " .. GetPedTextureVariation(ped, 5)  .. "}, -- Bags\n"
        .. "    {6,  " .. GetPedDrawableVariation(ped, 6)  .. ", " .. GetPedTextureVariation(ped, 6)  .. "}, -- Shoes\n"
        .. "    {7,  " .. GetPedDrawableVariation(ped, 7)  .. ", " .. GetPedTextureVariation(ped, 7)  .. "}, -- Neck\n"
        .. "    {8,  " .. GetPedDrawableVariation(ped, 8)  .. ", " .. GetPedTextureVariation(ped, 8)  .. "}, -- Shirt\n"
        .. "    {9,  " .. GetPedDrawableVariation(ped, 9)  .. ", " .. GetPedTextureVariation(ped, 9)  .. "}, -- Body Armor\n"
        .. "    {10, " .. GetPedDrawableVariation(ped, 10) .. ", " .. GetPedTextureVariation(ped, 10) .. "}, -- Badges\n"
        .. "    {11, " .. GetPedDrawableVariation(ped, 11) .. ", " .. GetPedTextureVariation(ped, 11) .. "}  -- Jackets\n"
        .. "},"
    print(props .. "\n" .. components)
end, false)

-- ── Admin access check ────────────────────────────────────────────────

local function checkAdminAccess(cb)
    checkAce(config.permissions.adminAce, function(hasAdmin)
        if hasAdmin then cb(true); return end
        local acesToCheck = {}
        local function addAce(a) if a then acesToCheck[a] = true end end
        addAce(config.permissions.deptManageAce)
        addAce(config.permissions.subManageAce)
        addAce(config.permissions.uniformManageAce)
        for _, dp in pairs(config.departmentPerms or {}) do
            addAce(dp.subManageAce)
            addAce(dp.uniformManageAce)
        end
        local list = {}
        for a in pairs(acesToCheck) do table.insert(list, a) end
        if #list == 0 then cb(false); return end
        local done, found = 0, false
        for _, a in ipairs(list) do
            checkAce(a, function(ok)
                done = done + 1
                if ok and not found then found = true; cb(true) end
                if done == #list and not found then cb(false) end
            end)
        end
    end)
end

-- ── Startup ───────────────────────────────────────────────────────────

Citizen.CreateThread(function()
    Citizen.Wait(500)
    if config.debug then print("[EUP DEBUG] Startup | checking ACEs...") end

    checkAce(config.permissions.menuAce, function(ok)
        menuAllowed = ok
        if config.debug then print("[EUP DEBUG] menuAce=" .. tostring(ok)) end
    end)

    checkAdminAccess(function(ok)
        isAdmin = ok
        if config.debug then print("[EUP DEBUG] isAdmin=" .. tostring(ok)) end
        TriggerServerEvent("eup:requestData")
    end)
end)

print("[EUP] Menu loaded.")
