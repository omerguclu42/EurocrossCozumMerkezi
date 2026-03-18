const fs = require('fs');
const file = 'index.html';
let content = fs.readFileSync(file, 'utf8');

// 1. Add icons to Ana Sayfa tables
content = content.replace(
    '<h3 style="font-size: 1.3rem; color: var(--primary-orange);">Ýç Müþteri Hizmet Þikayetleri</h3>',
    '<h3 style="font-size: 1.3rem; color: var(--primary-orange);"><i class="fas fa-hammer"></i> Ýç Müþteri Hizmet Þikayetleri</h3>'
);

content = content.replace(
    '<h3 style="font-size: 1.3rem; color: var(--primary-orange);">Ýç Müþteri Çaðrý Þikayetleri</h3>',
    '<h3 style="font-size: 1.3rem; color: var(--primary-orange);"><i class="fas fa-phone"></i> Ýç Müþteri Çaðrý Þikayetleri</h3>'
);

// 2. Add icons to Opinion tables and reorder
// We will simply regex match the table blocks. 
// For Bekleyen: 
// TABLE 1 = <!-- TABLE 1: HÝZMET ÞÝKAYETLERÝ (Görüþ Bekleyen) --> ... <!-- TABLE 2
// TABLE 2 = <!-- TABLE 2: ÇAÐRI ÞÝKAYETLERÝ (Görüþ Bekleyen) --> ... <!-- TABLE 2.5
// TABLE 2.5 = <!-- TABLE 2.5: DIÞ MÜÞTERÝ ÞÝKAYETLERÝ (Görüþ Bekleyen) --> ... </div>\n                    </div>\n\n                    <div class="dashboard-header"

const bekleyenMatch = content.match(/<!-- TABLE 1: HÝZMET(.*?)<!-- TABLE 2: ÇAÐRI(.*?)<!-- TABLE 2\.5: DIÞ MÜÞTERÝ(.*?)(?=\n {20}<\/div>\n {20}<\/div>\n\n {20}<div class="dashboard-header")/s);

if (bekleyenMatch) {
    let t1 = "<!-- TABLE 1: HÝZMET" + bekleyenMatch[1];
    let t2 = "<!-- TABLE 2: ÇAÐRI" + bekleyenMatch[2];
    let t25 = "<!-- TABLE 2.5: DIÞ MÜÞTERÝ" + bekleyenMatch[3];
    
    // Inject icons
    t1 = t1.replace('Bekleyen Ýç Müþteri Hizmet Þikayetleri</h3>', '<i class="fas fa-hammer"></i> Bekleyen Ýç Müþteri Hizmet Þikayetleri</h3>');
    t2 = t2.replace('Bekleyen Ýç Müþteri Çaðrý Þikayetleri</h3>', '<i class="fas fa-phone"></i> Bekleyen Ýç Müþteri Çaðrý Þikayetleri</h3>');
    t25 = t25.replace('<h3 style="font-size: 1.3rem; color: var(--primary-orange);">Bekleyen Dýþ Müþteri Þikayetleri</h3>', '<h3 style="font-size: 1.3rem; color: #2980b9;"><i class="fas fa-briefcase"></i> Bekleyen Dýþ Müþteri Þikayetleri</h3>');

    const newBekleyen = t25 + t1 + t2;
    content = content.replace(bekleyenMatch[0], newBekleyen);
    console.log("Bekleyen reordered.");
} else {
    console.log("Bekleyen match fail.");
}

// For Cevaplanan:
// TABLE 3 = <!-- TABLE 3: HÝZMET ...
// TABLE 4 = <!-- TABLE 4: ÇAÐRI ...
// TABLE 4.5 = <!-- TABLE 4.5: DIÞ ...

const cevaplananMatch = content.match(/<!-- TABLE 3: HÝZMET(.*?)<!-- TABLE 4: ÇAÐRI(.*?)<!-- TABLE 4\.5: DIÞ MÜÞTERÝ(.*?)(?=\n {20}<\/div>\n {16}<\/div>\n {12}<\/div>\n {12}<\/main>)/s);

if (cevaplananMatch) {
    let t3 = "<!-- TABLE 3: HÝZMET" + cevaplananMatch[1];
    let t4 = "<!-- TABLE 4: ÇAÐRI" + cevaplananMatch[2];
    let t45 = "<!-- TABLE 4.5: DIÞ MÜÞTERÝ" + cevaplananMatch[3];

    // Inject icons
    t3 = t3.replace('Cevaplanan Ýç Müþteri Hizmet Þikayetleri</h3>', '<i class="fas fa-hammer"></i> Cevaplanan Ýç Müþteri Hizmet Þikayetleri</h3>');
    t4 = t4.replace('Cevaplanan Ýç Müþteri Çaðrý Þikayetleri</h3>', '<i class="fas fa-phone"></i> Cevaplanan Ýç Müþteri Çaðrý Þikayetleri</h3>');
    t45 = t45.replace('<h3 style="font-size: 1.3rem; color: #27ae60;">Cevaplanan Dýþ Müþteri Þikayetleri</h3>', '<h3 style="font-size: 1.3rem; color: #2980b9;"><i class="fas fa-briefcase"></i> Cevaplanan Dýþ Müþteri Þikayetleri</h3>');

    const newCevaplanan = t45 + t3 + t4;
    content = content.replace(cevaplananMatch[0], newCevaplanan);
    console.log("Cevaplanan reordered.");
} else {
    // try fallback match
    console.log("Cevaplanan string structure mismatch, trying loose match.");
    const cMatch2 = content.match(/<!-- TABLE 3: HÝZMET(.*?)<!-- TABLE 4: ÇAÐRI(.*?)<!-- TABLE 4\.5: DIÞ MÜÞTERÝ(.*?)<\/main>/s);
    if(cMatch2) {
       let t3 = "<!-- TABLE 3: HÝZMET" + cMatch2[1];
       let t4 = "<!-- TABLE 4: ÇAÐRI" + cMatch2[2];
       let endSplit = cMatch2[3].split(/<\/div>\s*<\/div>\s*<\/main>/);
       let t45 = "<!-- TABLE 4.5: DIÞ MÜÞTERÝ" + endSplit[0];

       t3 = t3.replace('Cevaplanan Ýç Müþteri Hizmet Þikayetleri</h3>', '<i class="fas fa-hammer"></i> Cevaplanan Ýç Müþteri Hizmet Þikayetleri</h3>');
       t4 = t4.replace('Cevaplanan Ýç Müþteri Çaðrý Þikayetleri</h3>', '<i class="fas fa-phone"></i> Cevaplanan Ýç Müþteri Çaðrý Þikayetleri</h3>');
       t45 = t45.replace('<h3 style="font-size: 1.3rem; color: #27ae60;">Cevaplanan Dýþ Müþteri Þikayetleri</h3>', '<h3 style="font-size: 1.3rem; color: #2980b9;"><i class="fas fa-briefcase"></i> Cevaplanan Dýþ Müþteri Þikayetleri</h3>');

       const newC = t45 + t3 + t4 + "                    </div>\n                </div>\n            </main>";
       content = content.replace(cMatch2[0], newC);
       console.log("Cevaplanan reordered with loose match.");
    }
}

fs.writeFileSync(file, content);
console.log('HTML updated successfully.');
