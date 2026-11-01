const SUPABASE_URL = 'https://ssqmpzptapglvyyserok.supabase.co';
const SUPABASE_KEY = 'sb_publishable_DMl-vFYAKxX8BS1IR_3X0Q_KOey2ARr';

const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: window.location.protocol !== 'file:' }
});

let utilisateurConnecte = null;
let estProfesseur = false;
let CONTENU_SITE = {};
let progressionEleve = {};
let sectionActuelle = "algebre";

// Au chargement, vérifier si une session est active
window.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await db.auth.getSession();
    if (session) initialiserSession(session.user);
});

async function tentativeConnexion(e) {
    if (e) e.preventDefault();
    const loginError = document.getElementById('login-error');
    const btn = document.getElementById('login-btn');
    loginError.style.display = 'none';
    btn.textContent = "Vérification en cours...";

    let idSaisi = document.getElementById('login-id').value.trim().toLowerCase();
    const pwdSaisi = document.getElementById('login-pwd').value;
    const emailInterne = idSaisi.includes('@') ? idSaisi : `${idSaisi}@maths.local`;

    const { data, error } = await db.auth.signInWithPassword({
        email: emailInterne,
        password: pwdSaisi
    });

    btn.textContent = "Accéder à l'entraînement";
    if (error) {
        loginError.innerHTML = `Identifiant ou mot de passe incorrect.`;
        loginError.style.display = "block";
    } else if (data?.user) {
        initialiserSession(data.user);
    }
}

async function initialiserSession(user) {
    utilisateurConnecte = user;
    const identifiantCourt = user.email.split('@')[0];
    estProfesseur = (user.email === 'prof@maths.local');

    document.getElementById('user-display').textContent = `👤 ${identifiantCourt}`;
    if (estProfesseur) {
        document.getElementById('btn-admin').style.display = 'inline-block';
    }

    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('app-screen').style.display = 'block';

    // Chargement sécurisé du contenu depuis Supabase (sans les réponses !)
    const { data: siteData } = await db.rpc('charger_site_eleve');
    CONTENU_SITE = siteData || {};

    // Si la base est encore vide et que c'est le prof, on ouvre directement le panneau d'initialisation
    if (Object.keys(CONTENU_SITE).length === 0) {
        if (estProfesseur) {
            ouvrirPanneauProf();
        } else {
            document.getElementById('main-container').innerHTML = `<div class="content-box">Le professeur n'a pas encore publié les chapitres.</div>`;
        }
        return;
    }

    sectionActuelle = Object.keys(CONTENU_SITE)[0];
    await chargerProgressionEleve();
    construireBarreNavigation();
    afficherSection(sectionActuelle);
}

async function seDeconnecter() {
    await db.auth.signOut();
    window.location.reload();
}

async function chargerProgressionEleve() {
    const { data } = await db
        .from('reponses_eleves')
        .select('question_id, reponse_donnee, est_correct')
        .eq('user_id', utilisateurConnecte.id)
        .order('created_at', { ascending: true });

    progressionEleve = {};
    if (data) {
        data.forEach(row => {
            const dejaReussi = progressionEleve[row.question_id]?.est_correct || false;
            progressionEleve[row.question_id] = {
                est_correct: dejaReussi || row.est_correct,
                reponse: row.reponse_donnee
            };
        });
    }
    mettreAJourScore();
}

function mettreAJourScore() {
    let totalPoints = 0;
    for (const secKey in CONTENU_SITE) {
        CONTENU_SITE[secKey].categories.forEach(cat => {
            cat.chapitres.forEach(chap => {
                chap.exercices.forEach(exo => {
                    if (progressionEleve[exo.id]?.est_correct) totalPoints += exo.points;
                });
            });
        });
    }
    document.getElementById('score-display').textContent = `${totalPoints} pts`;
}

function construireBarreNavigation() {
    const nav = document.getElementById('nav-sections');
    nav.innerHTML = '';
    for (const key in CONTENU_SITE) {
        const btn = document.createElement('button');
        btn.className = `nav-btn ${key === sectionActuelle ? 'active' : ''}`;
        btn.textContent = CONTENU_SITE[key].titre;
        btn.onclick = () => afficherSection(key);
        nav.appendChild(btn);
    }
}

function chapitreEstComplete(chapId) {
    for (const secKey in CONTENU_SITE) {
        for (const cat of CONTENU_SITE[secKey].categories) {
            for (const chap of cat.chapitres) {
                if (chap.id === chapId) {
                    return chap.exercices.every(exo => progressionEleve[exo.id]?.est_correct);
                }
            }
        }
    }
    return false;
}

function trouverTitreChapitre(chapId) {
    for (const secKey in CONTENU_SITE) {
        for (const cat of CONTENU_SITE[secKey].categories) {
            for (const chap of cat.chapitres) {
                if (chap.id === chapId) return chap.titre;
            }
        }
    }
    return chapId;
}

function afficherSection(secKey) {
    sectionActuelle = secKey;
    construireBarreNavigation();
    const section = CONTENU_SITE[secKey];
    const container = document.getElementById('main-container');

    let html = `
        <div class="section-header">
            <div class="breadcrumb">Théorie & Exercices > ${section.titre}</div>
            <h1>${section.titre}</h1>
            <p class="section-intro">${section.intro}</p>
        </div>
    `;

    section.categories.forEach(cat => {
        html += `<h2 class="category-title">${cat.nom}</h2><p class="category-subtitle">${cat.sousTitre}</p>`;
        cat.chapitres.forEach(chap => {
            const prerequisOk = !chap.prerequis || chapitreEstComplete(chap.prerequis);
            const nomPrerequis = chap.prerequis ? trouverTitreChapitre(chap.prerequis) : '';

            html += `
                <div class="chapter-card">
                    <div class="chapter-header">
                        <h3 class="chapter-title">${chap.titre}</h3>
                        ${!prerequisOk ? `<span class="prereq-badge">🔒 Prérequis : ${nomPrerequis}</span>` : ''}
                    </div>
                    <p class="chapter-desc">${chap.description}</p>
                    <div class="chapter-grid">
                        <div>
                            <div class="grid-col-title">Points théoriques</div>
                            <div class="theory-list">
                                ${chap.theorie.map(th => `<a class="theory-link" onclick="afficherTheorie('${secKey}', '${chap.id}', '${th.id}')">📘 ${th.titre}</a>`).join('')}
                            </div>
                        </div>
                        <div>
                            <div class="grid-col-title">Exercices</div>
                            <div class="exo-pills">
                                ${chap.exercices.map(exo => {
                                    const statut = progressionEleve[exo.id];
                                    let classeStatut = !prerequisOk ? 'locked' : (statut?.est_correct ? 'solved' : (statut ? 'failed' : ''));
                                    const actionClic = prerequisOk ? `onclick="afficherExercice('${secKey}', '${chap.id}', '${exo.id}')"` : '';
                                    return `<div class="exo-pill ${classeStatut}" ${actionClic}>${exo.numero}</div>`;
                                }).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });
    });

    container.innerHTML = html;
    rendreLatex();
}

function afficherTheorie(secKey, chapId, thId) {
    const chap = trouverObjetChapitre(secKey, chapId);
    const th = chap.theorie.find(t => t.id === thId);
    document.getElementById('main-container').innerHTML = `
        <button class="back-btn" onclick="afficherSection('${secKey}')">← Retour à la section ${CONTENU_SITE[secKey].titre}</button>
        <div class="content-box">
            <div class="breadcrumb">${chap.titre} — Point théorique</div>
            ${th.contenu}
        </div>
    `;
    rendreLatex();
}

function afficherExercice(secKey, chapId, exoId) {
    const chap = trouverObjetChapitre(secKey, chapId);
    const exo = chap.exercices.find(e => e.id === exoId);
    const dejaReussi = progressionEleve[exo.id]?.est_correct || false;
    const ancienneReponse = progressionEleve[exo.id]?.reponse || "";

    let zoneInteraction = '';
    if (exo.type === 'latex') {
        zoneInteraction = `<math-field id="reponse-eleve" placeholder="\\text{Tapez votre réponse ici...}">${dejaReussi ? ancienneReponse : ''}</math-field>`;
    } else if (exo.type === 'qcm') {
        const lettres = ['A', 'B', 'C', 'D', 'E'];
        zoneInteraction = `
            <div class="options-list">
                ${exo.options.map((opt, idx) => `
                    <div class="option-item ${dejaReussi && ancienneReponse === 'Choix_' + idx ? 'selected' : ''}" data-index="${idx}">
                        <div class="option-letter">${lettres[idx]}</div>
                        <div class="option-content">${opt.texte}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    document.getElementById('main-container').innerHTML = `
        <button class="back-btn" onclick="afficherSection('${secKey}')">← Retour au chapitre "${chap.titre}"</button>
        <div class="content-box">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <span class="breadcrumb">${chap.titre} — Exercice ${exo.numero}</span>
                <span class="score-badge">${exo.points} points</span>
            </div>
            <h2 style="font-weight:500; font-size:1.3rem; margin-top:0;">${exo.enonce}</h2>
            ${zoneInteraction}
            <button class="btn-primary" id="btn-valider-exo">Vérifier la réponse</button>
            <div id="feedback-exo" class="feedback-box ${dejaReussi ? 'correct' : ''}" style="${dejaReussi ? 'display:block' : ''}">
                ${dejaReussi ? '✨ Vous avez déjà résolu cet exercice avec succès !' : ''}
            </div>
        </div>
    `;

    rendreLatex();
    attacherEvenementsExercice(exo);
}

function attacherEvenementsExercice(exo) {
    const btnValider = document.getElementById('btn-valider-exo');
    const feedback = document.getElementById('feedback-exo');
    let indexQcmChoisi = null;

    if (exo.type === 'qcm') {
        const items = document.querySelectorAll('.option-item');
        items.forEach(item => {
            item.addEventListener('click', () => {
                items.forEach(i => i.classList.remove('selected'));
                item.classList.add('selected');
                indexQcmChoisi = parseInt(item.getAttribute('data-index'));
                feedback.style.display = 'none';
            });
        });
    }

    btnValider.addEventListener('click', async () => {
        let reponseBrute = "";
        let reponseClean = "";

        if (exo.type === 'latex') {
            const mf = document.getElementById('reponse-eleve');
            reponseBrute = mf.value || "";
            reponseClean = nettoyerLatex(reponseBrute);
            if (!reponseClean) return afficherFeedback(feedback, "Veuillez entrer une réponse.", false);
        } else if (exo.type === 'qcm') {
            if (indexQcmChoisi === null) return afficherFeedback(feedback, "Veuillez sélectionner une proposition.", false);
            reponseBrute = `Choix_${indexQcmChoisi}`;
            reponseClean = indexQcmChoisi.toString();
        }

        btnValider.textContent = "Vérification sur le serveur...";
        // Vérification 100% côté serveur (anti-triche)
        const { data: res, error } = await db.rpc('verifier_reponse_serveur', {
            p_exo_id: exo.id,
            p_reponse_clean: reponseClean,
            p_reponse_brute: reponseBrute
        });
        btnValider.textContent = "Vérifier la réponse";

        if (error || !res) {
            return afficherFeedback(feedback, "Erreur lors de la vérification.", false);
        }

        if (res.est_correct) {
            afficherFeedback(feedback, `✨ Bravo ! C'est exact (+${res.points} points).`, true);
        } else {
            afficherFeedback(feedback, `Ce n'est pas la bonne réponse. Indice : ${res.indice || 'Réessayez !'}`, false);
        }

        await chargerProgressionEleve();
    });
}

// =========================================================================
// ESPACE PROFESSEUR (AJOUT DE COURS/EXOS & SUIVI DES ÉLÈVES)
// =========================================================================
async function ouvrirPanneauProf() {
    const container = document.getElementById('main-container');
    
    // Récupérer la configuration complète (avec les réponses)
    const { data: configRow } = await db.from('configuration_site').select('data').eq('id', 1).single();
    let fullData = configRow ? configRow.data : obtenirModeleInitial();

    // Récupérer les 30 dernières réponses des élèves
    const { data: historique } = await db.from('reponses_eleves').select('*').order('created_at', { ascending: false }).limit(30);

    const optionsChapitres = [];
    for (const sKey in fullData) {
        fullData[sKey].categories.forEach((cat, cIdx) => {
            cat.chapitres.forEach((chap, chIdx) => {
                optionsChapitres.push({ label: `${fullData[sKey].titre} > ${chap.titre}`, val: `${sKey}|${cIdx}|${chIdx}` });
            });
        });
    }

    container.innerHTML = `
        <div class="content-box" style="margin-bottom:30px;">
            <div class="breadcrumb">Administration — Réservé au professeur</div>
            <h2>1. Ajouter rapidement un exercice ou un cours</h2>
            
            <div class="form-group">
                <label>Dans quel chapitre ?</label>
                <select id="adm-chap" class="form-input">
                    ${optionsChapitres.map(o => `<option value="${o.val}">${o.label}</option>`).join('')}
                </select>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px; margin-top:20px;">
                <!-- Colonne Ajout Cours -->
                <div style="background:rgba(15,23,42,0.5); padding:20px; border-radius:12px;">
                    <h3 style="margin-top:0;">📘 Nouveau point théorique</h3>
                    <div class="form-group">
                        <label>Titre du cours (ex: 3. Théorème de Thalès)</label>
                        <input type="text" id="th-titre" class="form-input">
                    </div>
                    <div class="form-group">
                        <label>Contenu HTML / LaTeX ($...$ ou $$...$$)</label>
                        <textarea id="th-contenu" class="admin-textarea" placeholder="<h2>Titre</h2><p>Votre texte avec $\\Delta = b^2-4ac$...</p>"></textarea>
                    </div>
                    <button class="btn-primary" onclick="ajouterCoursRapide()">Publier ce cours</button>
                </div>

                <!-- Colonne Ajout Exercice -->
                <div style="background:rgba(15,23,42,0.5); padding:20px; border-radius:12px;">
                    <h3 style="margin-top:0;">🎯 Nouvel exercice (Réponse LaTeX)</h3>
                    <div class="form-group">
                        <label>Énoncé en LaTeX</label>
                        <input type="text" id="exo-enonce" class="form-input" placeholder="Factoriser $x^2 - 4$...">
                    </div>
                    <div class="form-group">
                        <label>Réponses acceptées (séparées par une virgule)</label>
                        <input type="text" id="exo-reponses" class="form-input" placeholder="(x-2)(x+2), (x+2)(x-2)">
                    </div>
                    <div class="form-group">
                        <label>Indice en cas d'erreur & Points</label>
                        <div style="display:flex; gap:10px;">
                            <input type="text" id="exo-indice" class="form-input" placeholder="Pensez à a² - b² !">
                            <input type="number" id="exo-pts" class="form-input" value="5" style="width:90px;">
                        </div>
                    </div>
                    <button class="btn-primary" onclick="ajouterExoRapide()">Publier cet exercice</button>
                </div>
            </div>
        </div>

        <div class="content-box" style="margin-bottom:30px;">
            <h2>2. Dernières réponses des élèves en direct</h2>
            <table class="admin-table">
                <thead><tr><th>Élève</th><th>Exercice</th><th>Réponse tapée</th><th>Statut</th><th>Date</th></tr></thead>
                <tbody>
                    ${(historique || []).map(h => `
                        <tr>
                            <td><b>${h.identifiant_eleve}</b></td>
                            <td>${h.question_id}</td>
                            <td><code>${h.reponse_donnee}</code></td>
                            <td style="color:${h.est_correct ? '#34d399' : '#f87171'}">${h.est_correct ? '✔ Correct' : '✘ Faux'}</td>
                            <td>${new Date(h.created_at).toLocaleString('fr-FR')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>

        <div class="content-box">
            <h2>3. Éditeur global de la structure (JSON)</h2>
            <p style="color:var(--text-muted); font-size:0.9rem;">Vous pouvez modifier, réorganiser ou sauvegarder l'intégralité des chapitres et exercices ici :</p>
            <textarea id="json-complet" class="admin-textarea" style="min-height:280px;">${JSON.stringify(fullData, null, 2)}</textarea>
            <button class="btn-primary" onclick="sauvegarderJsonComplet()">💾 Enregistrer toute la structure sur Supabase</button>
            <div id="admin-feedback" class="feedback-box"></div>
        </div>
    `;
}

async function sauvegarderJsonComplet() {
    const feedback = document.getElementById('admin-feedback');
    try {
        const parsed = JSON.parse(document.getElementById('json-complet').value);
        const { error } = await db.from('configuration_site').upsert({ id: 1, data: parsed });
        if (error) throw error;
        afficherFeedback(feedback, "✨ Structure enregistrée avec succès sur Supabase !", true);
        const { data: siteData } = await db.rpc('charger_site_eleve');
        CONTENU_SITE = siteData;
        construireBarreNavigation();
    } catch (err) {
        afficherFeedback(feedback, "Erreur dans le format JSON : " + err.message, false);
    }
}

async function ajouterCoursRapide() {
    const fullData = JSON.parse(document.getElementById('json-complet').value);
    const [sKey, cIdx, chIdx] = document.getElementById('adm-chap').value.split('|');
    const titre = document.getElementById('th-titre').value.trim();
    const contenu = document.getElementById('th-contenu').value.trim();
    if (!titre || !contenu) return alert("Remplissez le titre et le contenu du cours.");

    fullData[sKey].categories[cIdx].chapitres[chIdx].theorie.push({
        id: 'th_' + Date.now(),
        titre: titre,
        contenu: contenu
    });
    document.getElementById('json-complet').value = JSON.stringify(fullData, null, 2);
    await sauvegarderJsonComplet();
}

async function ajouterExoRapide() {
    const fullData = JSON.parse(document.getElementById('json-complet').value);
    const [sKey, cIdx, chIdx] = document.getElementById('adm-chap').value.split('|');
    const chap = fullData[sKey].categories[cIdx].chapitres[chIdx];

    const enonce = document.getElementById('exo-enonce').value.trim();
    const reponses = document.getElementById('exo-reponses').value.split(',').map(r => r.trim()).filter(Boolean);
    const indice = document.getElementById('exo-indice').value.trim();
    const pts = parseInt(document.getElementById('exo-pts').value) || 5;
    if (!enonce || reponses.length === 0) return alert("Remplissez l'énoncé et au moins une réponse valide.");

    chap.exercices.push({
        id: 'exo_' + Date.now(),
        numero: chap.exercices.length + 1,
        points: pts,
        type: 'latex',
        enonce: enonce,
        reponsesValides: reponses,
        indiceErreur: indice
    });
    document.getElementById('json-complet').value = JSON.stringify(fullData, null, 2);
    await sauvegarderJsonComplet();
}

// Modèle de départ (chargé automatiquement la toute première fois que vous vous connectez en "prof")
function obtenirModeleInitial() {
    return {
        "algebre": {
            titre: "Algèbre",
            intro: "L'algèbre est un pilier des Olympiades de 4e/3e et du Concours Général.",
            categories: [{
                nom: "Les essentiels",
                sousTitre: "Les techniques de calcul indispensables.",
                chapitres: [{
                    id: "chap_identites",
                    titre: "Calcul littéral & Factorisations",
                    prerequis: null,
                    description: "Factoriser une somme pour la transformer en produit.",
                    theorie: [{
                        id: "th_id_rem",
                        titre: "1. Identités remarquables",
                        contenu: "<h2>Identités remarquables</h2><div class='theorem-box'>$$(a+b)^2 = a^2 + 2ab + b^2$$$$(a-b)(a+b) = a^2 - b^2$$</div>"
                    }],
                    exercices: [{
                        id: "exo_alg_1",
                        numero: 1,
                        points: 5,
                        type: "latex",
                        enonce: "Factoriser dans $\\mathbb{R}$ le polynôme $x^2+x-6$.",
                        reponsesValides: ["(x-2)(x+3)", "(x-2)(3+x)", "(-2+x)(x+3)", "(-2+x)(3+x)", "(x+3)(x-2)", "(3+x)(x-2)", "(x+3)(-2+x)", "(3+x)(-2+x)"],
                        indiceErreur: "Cherchez deux nombres dont le produit vaut -6 et la somme vaut 1."
                    }]
                }]
            }]
        },
        "geometrie": {
            titre: "Géométrie",
            intro: "Chasse aux angles, triangles semblables et théorème de Pythagore.",
            categories: [{
                nom: "Les essentiels",
                sousTitre: "Outils fondamentaux de géométrie plane.",
                chapitres: [{
                    id: "chap_angles",
                    titre: "Chasse aux angles et Polygones",
                    prerequis: null,
                    description: "Déterminer la somme des angles d'un polygone.",
                    theorie: [{
                        id: "th_angles_poly",
                        titre: "1. Somme des angles d'un polygone",
                        contenu: "<h2>Polygone à $n$ côtés</h2><p>La somme des angles intérieurs vaut $(n-2) \\times 180^\\circ$.</p>"
                    }],
                    exercices: [{
                        id: "exo_geo_1",
                        numero: 1,
                        points: 5,
                        type: "latex",
                        enonce: "Combien mesure (en degrés) chaque angle intérieur d'un hexagone régulier ?",
                        reponsesValides: ["120"],
                        indiceErreur: "La somme des 6 angles vaut $(6-2) \\times 180^\\circ$."
                    }]
                }]
            }]
        }
    };
}

function afficherFeedback(el, message, succes) {
    el.innerHTML = message;
    el.className = `feedback-box ${succes ? 'correct' : 'incorrect'}`;
    el.style.display = 'block';
    rendreLatex();
}

function nettoyerLatex(raw) {
    return raw
        .replace(/\\left/g, '').replace(/\\right/g, '').replace(/\\mleft/g, '').replace(/\\mright/g, '')
        .replace(/\\,/g, '').replace(/\\:/g, '').replace(/\\;/g, '').replace(/\\ /g, '')
        .replace(/\s+/g, '').replace(/\\cdot/g, '').replace(/\\times/g, '').replace(/\*/g, '')
        .replace(/\{/g, '').replace(/\}/g, '').replace(/^1\(/, '(').toLowerCase();
}

function trouverObjetChapitre(secKey, chapId) {
    for (const cat of CONTENU_SITE[secKey].categories) {
        for (const chap of cat.chapitres) {
            if (chap.id === chapId) return chap;
        }
    }
    return null;
}

function rendreLatex() {
    if (window.renderMathInElement) {
        renderMathInElement(document.body, {
            delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}]
        });
    }
}