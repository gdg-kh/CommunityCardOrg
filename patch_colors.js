const fs = require('fs');

const dataPath = '2026/data.json';
const eventsPath = '2026/events.json';

// Read files
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));

// Extract colors from events
const communityColors = {};
events.forEach(event => {
    if (event.community && event.color && !communityColors[event.community]) {
        communityColors[event.community] = event.color;
    }
});

// We need to match names from events.json to data.json
// events: "GDG Kaohsiung", data: "Google Developer Groups Kaohsiung 臉書社團"
const nameMapping = {
    "Google Developer Groups Kaohsiung 臉書社團": "GDG Kaohsiung",
    "開發者 Buffet Discord": "開發者 Buffet",
    "國泰 CDC 小聚": "國泰 CDC 小聚",
    "高雄 WordPress 小聚 Kaohsiung WordPress Meetup": "高雄 WordPress",
    "Second Space 臉書社團": "Second Space",
    "KaLUG 官方網站": "KaLUG",
    "Pyladies Kaohsiung 官網": "PyLadies Kaohsiung",
    "KIMU 高雄獨立遊戲開發者聚會 臉書社團": "KIMU - 高雄獨立遊戲開發者聚會",
    "南台灣敏捷社群 臉書社團": "南台灣敏捷社群", // No event currently, will leave color out or default
    "K.NET": "K.NET",
    "VSCP 粉鳥趴": "氛圍工作者交流趴（粉鳥趴）",
    "UIUX.Kaohsiung": "UIUX Kaohsiung",
    "vLAB Online 台灣路由網路實驗中心": "vLAB Online"
};

// Apply colors to data.json
data.communities = data.communities.map(community => {
    const eventName = nameMapping[community.name];
    if (eventName && communityColors[eventName]) {
        return { ...community, color: communityColors[eventName] };
    }
    // Default color if not found in events
    return community;
});

// Write back to data.json
fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log('Successfully updated data.json with colors!');
