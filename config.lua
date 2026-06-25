config = {
    debug = false,

    -- Which accessory prop slots to capture when saving a uniform.
    -- Disable any you don't want saved (e.g. set glasses = false if officers pick their own).
    captureProps = {
        hats      = true,   -- prop slot 0
        glasses   = true,   -- prop slot 1
        ears      = true,   -- prop slot 2  (earrings / earpieces)
        watches   = true,   -- prop slot 6
        bracelets = true,   -- prop slot 7
    },

    enableOpenCommand = true,
    openCommand = "eup",

    enableAccessCircles = true,
    accessCircles = {
        {x = 448.0,   y = 6008.4,  z = 30.71},  -- Paleto PD
        {x = 1849.10, y = 3689.49, z = 33.26},  -- Sandy PD
        {x = 454.4,   y = -989.1,  z = 29.68},  -- Mission Row PD
    },

    permissions = {
        -- ACE required to open the EUP menu. Set to nil to allow everyone.
        menuAce = "eup.use",

        -- ACE required to see and use the Admin Panel. Set to nil to disable admin panel entirely.
        adminAce = "eup.admin",

        -- Optional per-operation-group ACEs. If nil, falls back to adminAce.
        -- Useful for delegating specific operations without granting full admin.
        deptManageAce    = nil,   -- create / delete departments
        subManageAce     = nil,   -- create / delete sub-categories
        uniformManageAce = nil,   -- save / override / rename / move / delete uniforms
    },

    -- Per-department ACE overrides.
    -- Keys must match department names exactly. Both fields are optional.
    -- A player with a dept ACE can manage that department without needing the global ACE.
    -- Example:
    --   ["San Andreas Highway Patrol"] = {
    --       subManageAce     = "eup.sahp.sub",
    --       uniformManageAce = "eup.sahp.uniforms",
    --   },
    departmentPerms = {},

    -- Discord webhook logging. Leave url blank to disable.
    webhook = {
        url      = "",
        username = "EUP Menu",
    },
}
