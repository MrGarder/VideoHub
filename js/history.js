console.log("HISTORY.JS ЗАГРУЗИЛСЯ ✔", "watch_history:", localStorage.getItem("watch_history"));

// ===== ВРЕМЯ =====
function timeAgo(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return "только что";
    if (diff < 3600000) return Math.floor(diff/60000) + " мин назад";
    if (diff < 86400000) return Math.floor(diff/3600000) + " час назад";
    return Math.floor(diff/86400000) + " дней назад";
}

// ===== ЗАГРУЗКА =====
function loadHistory() {
    // единый ключ: "watch_history"
    let history = JSON.parse(localStorage.getItem("watch_history") || "[]");

    const list = document.getElementById("historyPageList");
    if(!list){
      console.warn("historyPageList не найден в DOM");
      return;
    }
    list.innerHTML = "";

    if (history.length === 0) {
        list.innerHTML = "<p style='opacity:.7; padding:20px;'>История пуста.</p>";
        return;
    }

    history.forEach((v, i) => {
        const item = document.createElement("div");
        item.className = "history-item";

        // безопасный thumb (если пусто — не подставляем пустой src)
        const thumbSrc = v.thumbnail || v.thumb || "";

        item.innerHTML = `
            <img class="thumb" src="${thumbSrc}" onerror="this.style.opacity='.4';this.style.background='#222'">
            <div style="flex:1;min-width:0">
                <div class="title">${escapeHtml(v.title||"Без названия")}</div>
                <div class="time">${timeAgo(v.time)}</div>
            </div>
            <button class="delete-one" data-index="${i}" title="Удалить">✖</button>
        `;

        // клик по элементу — открытие видео (если есть id)
        item.addEventListener("click", (ev) => {
            // если клик на кнопку удаления — игнорируем переход
            if(ev.target.closest(".delete-one")) return;
            if(v.id){
              // открываем страницу просмотра
              location.href = `watch.html?v=${encodeURIComponent(v.id)}`;
            }
        });

        list.appendChild(item);
    });

    // обработчики удаления по кнопке
    document.querySelectorAll(".delete-one").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            let history = JSON.parse(localStorage.getItem("watch_history") || "[]");
            const index = parseInt(btn.dataset.index);
            if (!Number.isFinite(index)) return;
            history.splice(index, 1);
            localStorage.setItem("watch_history", JSON.stringify(history));
            loadHistory();
        };
    });
}

function escapeHtml(s){ return (s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }

// Инициируем
document.addEventListener("DOMContentLoaded", loadHistory);

// ===== ОЧИСТИТЬ ВСЁ =====
document.addEventListener("DOMContentLoaded", () => {
    const clearBtn = document.getElementById("clearAll");
    if(clearBtn){
      clearBtn.onclick = () => {
        localStorage.removeItem("watch_history");
        loadHistory();
      };
    }
});
