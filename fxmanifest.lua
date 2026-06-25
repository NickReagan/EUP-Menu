-- Don't change anything. For support join my discord: https://discord.gg/Z9Mxu72zZ6
fx_version "cerulean"
game "gta5"

title "EUP Menu"
description "EUP Menu created by Andyyy#7666"
author "Andyyy#7666"
version "v1.1"

server_script "server.lua"

shared_scripts {
    "config.lua"
}

client_scripts {
    "menu.lua"
}

ui_page "html/index.html"

files {
    "html/index.html",
    "html/style.css",
    "html/app.js",
}
