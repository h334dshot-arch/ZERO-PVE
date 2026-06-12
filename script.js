

async function loadServerStats(){
    try{
        const response = await fetch("/api/server-stats?cache=" + Date.now());
        if(!response.ok) return;

        const data = await response.json();

        if(data.map){
            const op = document.getElementById("operationName");
            if(op) op.textContent = String(data.map).toUpperCase();
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
