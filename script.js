

async function loadServerStats(){
    try{
        const response = await fetch("/api/server-stats?cache=" + Date.now());
        if(!response.ok) return;

        const data = await response.json();

        const operation = data.operation || data.operationName || data.map;
        if(operation){
            const op = document.getElementById("operationName");
            if(op) op.textContent = String(operation).toUpperCase();
        }

        if(Array.isArray(data.players)){
            const list = document.getElementById("playersList");
            const count = document.getElementById("onlineCount");

            if(list){
                list.innerHTML = "";
                data.players.forEach(player => {
                    const li = document.createElement("li");
                    li.textContent = player;
                    list.appendChild(li);
                });
            }

            if(count){
                count.textContent = `(${data.players.length})`;
            }
        }

        const fps = document.getElementById("serverFps");
        const ai = document.getElementById("serverAi");
        const vehicles = document.getElementById("serverVehicles");
        const uptime = document.getElementById("serverUptime");
        const updated = document.getElementById("statsUpdated");

        if(fps && data.fps !== undefined) fps.textContent = data.fps;
        if(ai && data.ai !== undefined) ai.textContent = data.ai;
        if(vehicles && data.vehicles !== undefined) vehicles.textContent = data.vehicles;
        if(uptime && data.uptime !== undefined) uptime.textContent = data.uptime;
        if(updated && data.updatedAt) updated.textContent = data.updatedAt;
    }catch(error){
        // Mantém os dados estáticos se o JSON/API não responder.
    }
}

loadServerStats();
setInterval(loadServerStats, 30000);

let currentRankPeriod = "weekly";
let cachedKillData = null;

function setText(id, value){
    const el = document.getElementById(id);
    if(el) el.textContent = value;
}

function formatKillTime(value){
    const date = new Date(value);
    if(Number.isNaN(date.getTime())) return "--:--";
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function renderTopCards(data){
    const weekly = data.weekly && data.weekly[0];
    const monthly = data.monthly && data.monthly[0];

    setText("weeklyTopName", weekly ? weekly.name : "Aguardando");
    setText("weeklyTopKills", weekly ? weekly.kills : "0");
    setText("weeklyTopDeaths", weekly ? weekly.deaths : "0");

    setText("monthlyTopName", monthly ? monthly.name : "Aguardando");
    setText("monthlyTopKills", monthly ? monthly.kills : "0");
    setText("monthlyTopDeaths", monthly ? monthly.deaths : "0");
}

function renderRankingTable(data){
    const body = document.getElementById("rankingBody");
    if(!body) return;

    const rows = data[currentRankPeriod] || [];
    if(!rows.length){
        body.innerHTML = '<tr><td colspan="6">Aguardando kill feed...</td></tr>';
        return;
    }

    body.innerHTML = "";
    rows.forEach((player, index) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${index + 1}</td>
            <td>${player.name}</td>
            <td>${player.kills}</td>
            <td>${player.deaths}</td>
            <td>${player.teamKills}</td>
            <td><span class="status-active">${player.score}</span></td>
        `;
        body.appendChild(tr);
    });
}

function renderKillFeed(data){
    const list = document.getElementById("killFeedList");
    if(!list) return;

    const feed = data.feed || [];
    if(!feed.length){
        list.innerHTML = '<article class="kill-feed-item">Aguardando eventos...</article>';
        return;
    }

    list.innerHTML = "";
    feed.slice(0, 30).forEach(event => {
        const item = document.createElement("article");
        item.className = "kill-feed-item";
        let tag = "KILL";
        if(event.suicide){
            tag = "SUICIDIO";
        }else if(event.teamKill){
            tag = "TEAM KILL";
        }else if(event.victimType === "ai"){
            tag = "KILL AI";
        }else if(event.killerType === "ai"){
            tag = "AI KILL";
        }
        item.innerHTML = `
            <div>
                <strong>${event.killerName}</strong>
                <span>${tag} em ${event.victimName}</span>
            </div>
            <small>${event.weapon || "Unknown"} - ${event.distance || "0"}m - ${formatKillTime(event.receivedAt || event.timestamp)}</small>
        `;
        list.appendChild(item);
    });
}

function renderKillData(data){
    cachedKillData = data;
    renderTopCards(data);
    renderRankingTable(data);
    renderKillFeed(data);
    setText("rankingUpdated", "Atualizado " + formatKillTime(data.updatedAt));
}

async function loadKillFeed(){
    if(!document.getElementById("rankingBody") && !document.getElementById("weeklyTopName")) return;

    try{
        const response = await fetch("/api/kill-feed?cache=" + Date.now());
        if(!response.ok) return;
        const data = await response.json();
        renderKillData(data);
    }catch(error){
        // Mantem os dados estaticos se a API nao responder.
    }
}

document.querySelectorAll("[data-rank-period]").forEach(button => {
    button.addEventListener("click", () => {
        currentRankPeriod = button.dataset.rankPeriod;
        document.querySelectorAll("[data-rank-period]").forEach(tab => tab.classList.remove("active"));
        button.classList.add("active");
        if(cachedKillData) renderRankingTable(cachedKillData);
    });
});

loadKillFeed();
setInterval(loadKillFeed, 30000);
