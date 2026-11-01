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

// Variables pour l'éditeur visuel du professeur
let adminFullData = null;
let admSec = null;
let admCatIdx = 0;
let admChapIdx = 0;

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

    await rechargerSiteEleve();

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

async function rechargerSiteEleve() {
    const { data: siteData } = await db.rpc('charger_site_eleve');
    CONTENU_SITE = siteData || {};
}

async function seDeconnecter() {
    await db.auth.signOut();
    window.location.reload();
}

// =========================================================================
// PARTIE ÉLÈVE : NAVIGATION, COURS ET EXERCICES
// =========================================================================
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
        (CONTENU_SITE[secKey].categories || []).forEach(cat => {
            (cat.chapitres || []).forEach(chap => {
                (chap.exercices || []).forEach(exo => {
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
        for (const cat of (CONTENU_SITE[secKey].categories || [])) {
            for (const chap of (cat.chapitres || [])) {
                if (chap.id === chapId) {
                    if (!chap.exercices || chap.exercices.length === 0) return true;
                    return chap.exercices.every(exo => progressionEleve[exo.id]?.est_correct);
                }
            }
        }
    }
    return false;
}

function trouverTitreChapitre(chapId) {
    for (const secKey in CONTENU_SITE) {
        for (const cat of (CONTENU_SITE[secKey].categories || [])) {
            for (const chap of (cat.chapitres || [])) {
                if (chap.id === chapId) return chap.titre;
            }
        }
    }
    return chapId;
}

function afficherSection(secKey) {
    if (!CONTENU_SITE[secKey]) secKey = Object.keys(CONTENU_SITE)[0];
    if (!secKey) return;
    sectionActuelle = secKey;
    construireBarreNavigation();
    const section = CONTENU_SITE[secKey];
    const container = document.getElementById('main-container');

    let html = `
        <div class="section-header">
            <div class="breadcrumb">Théorie & Exercices > ${section.titre}</div>
            <h1>${section.titre}</h1>
            <p class="section-intro">${section.intro || ''}</p>
        </div>
    `;

    (section.categories || []).forEach(cat => {
        html += `<h2 class="category-title">${cat.nom}</h2><p class="category-subtitle">${cat.sousTitre || ''}</p>`;
        (cat.chapitres || []).forEach(chap => {
            const prerequisOk = !chap.prerequis || chapitreEstComplete(chap.prerequis);
            const nomPrerequis = chap.prerequis ? trouverTitreChapitre(chap.prerequis) : '';

            html += `
                <div class="chapter-card">
                    <div class="chapter-header">
                        <h3 class="chapter-title">${chap.titre}</h3>
                        ${!prerequisOk ? `<span class="prereq-badge">🔒 Prérequis : ${nomPrerequis}</span>` : ''}
                    </div>
                    <p class="chapter-desc">${chap.description || ''}</p>
                    <div class="chapter-grid">
                        <div>
                            <div class="grid-col-title">Points théoriques</div>
                            <div class="theory-list">
                                ${(chap.theorie || []).length === 0 ? `<span style="color:var(--text-muted);font-size:0.85rem;">Aucun cours pour le moment</span>` : ''}
                                ${(chap.theorie || []).map(th => `<a class="theory-link" onclick="afficherTheorie('${secKey}', '${chap.id}', '${th.id}')">📘 ${th.titre}</a>`).join('')}
                            </div>
                        </div>
                        <div>
                            <div class="grid-col-title">Exercices</div>
                            <div class="exo-pills">
                                ${(chap.exercices || []).length === 0 ? `<span style="color:var(--text-muted);font-size:0.85rem;">Aucun exercice</span>` : ''}
                                ${(chap.exercices || []).map(exo => {
                                    const statut = progressionEleve[exo.id];
                                    let classeStatut = !prerequisOk ? 'locked' : (statut?.est_correct ? 'solved' : (statut ? 'failed' : ''));
                                    const actionClic = prerequisOk ? `onclick="afficherExercice('${secKey}', '${chap.id}', '${exo.id}')"` : `title="Terminez d'abord : ${nomPrerequis}"`;
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
        const lettres = ['A', 'B', 'C', 'D', 'E', 'F'];
        zoneInteraction = `
            <div class="options-list">
                ${(exo.options || []).map((opt, idx) => `
                    <div class="option-item ${dejaReussi && ancienneReponse === 'Choix_' + idx ? 'selected' : ''}" data-index="${idx}">
                        <div class="option-letter">${lettres[idx] || (idx + 1)}</div>
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
            <div style="font-size:1.2rem; margin-bottom:20px; line-height:1.6;">${exo.enonce}</div>
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

        btnValider.textContent = "Vérification en cours...";
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
            afficherFeedback(feedback, `Ce n'est pas la bonne réponse. ${res.indice ? '<br>💡 <b>Indice :</b> ' + res.indice : ''}`, false);
        }

        await chargerProgressionEleve();
    });
}

// =========================================================================
// ESPACE PROFESSEUR VISUEL (ZÉRO JSON À MANIPULER !)
// =========================================================================
async function ouvrirPanneauProf() {
    const { data: configRow } = await db.from('configuration_site').select('data').eq('id', 1).single();
    if (configRow && configRow.data && Object.keys(configRow.data).length > 0) {
        adminFullData = configRow.data;
    } else {
        adminFullData = obtenirModeleInitial();
        await sauvegarderSilence();
    }

    if (!admSec || !adminFullData[admSec]) admSec = Object.keys(adminFullData)[0];
    admCatIdx = 0;
    admChapIdx = 0;

    afficherTableauDeBordProf();
}

async function sauvegarderSilence() {
    const { error } = await db.from('configuration_site').upsert({ id: 1, data: adminFullData });
    if (error) {
        alert("Erreur lors de la sauvegarde sur Supabase : " + error.message);
        return false;
    }
    await rechargerSiteEleve();
    construireBarreNavigation();
    return true;
}

async function afficherTableauDeBordProf() {
    const container = document.getElementById('main-container');
    
    // Sécuriser les index sélectionnés
    const secKeys = Object.keys(adminFullData);
    if (!admSec || !adminFullData[admSec]) admSec = secKeys[0];
    const secObj = adminFullData[admSec];
    if (!secObj.categories) secObj.categories = [];
    if (admCatIdx >= secObj.categories.length) admCatIdx = Math.max(0, secObj.categories.length - 1);
    const catObj = secObj.categories[admCatIdx] || null;
    if (catObj && !catObj.chapitres) catObj.chapitres = [];
    if (catObj && admChapIdx >= catObj.chapitres.length) admChapIdx = Math.max(0, catObj.chapitres.length - 1);
    const chapObj = (catObj && catObj.chapitres[admChapIdx]) ? catObj.chapitres[admChapIdx] : null;

    // Liste de tous les chapitres pour le menu "Prérequis"
    const tousLesChapitres = [];
    for (const k in adminFullData) {
        (adminFullData[k].categories || []).forEach(c => {
            (c.chapitres || []).forEach(ch => {
                if (!chapObj || ch.id !== chapObj.id) {
                    tousLesChapitres.push({ id: ch.id, titre: `${adminFullData[k].titre} > ${ch.titre}` });
                }
            });
        });
    }

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <button class="back-btn" style="margin:0;" onclick="afficherSection(sectionActuelle)">← Quitter le Mode Prof</button>
            <div style="display:flex; gap:10px;">
                <button class="nav-btn active" onclick="afficherTableauDeBordProf()">📚 Gérer les Cours & Exos</button>
                <button class="nav-btn" onclick="afficherSuiviElevesProf()">📊 Résultats des Élèves</button>
            </div>
        </div>

        <!-- 1. SÉLECTEUR D'ARBORESCENCE (Section > Catégorie > Chapitre) -->
        <div class="content-box" style="margin-bottom:25px; padding:25px 30px;">
            <div class="breadcrumb">1. Choisissez où travailler</div>
            <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:18px; margin-top:12px;">
                
                <!-- Colonne Section -->
                <div style="background:rgba(15,23,42,0.5); padding:15px; border-radius:10px; border:1px solid var(--border-color);">
                    <label style="font-size:0.8rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">1. Domaine (Section)</label>
                    <select class="form-input" style="margin:8px 0;" onchange="changerSelectionProf('sec', this.value)">
                        ${secKeys.map(k => `<option value="${k}" ${k === admSec ? 'selected' : ''}>${adminFullData[k].titre}</option>`).join('')}
                    </select>
                    <div style="display:flex; gap:6px;">
                        <button class="back-btn" style="margin:0; flex:1; padding:6px; font-size:0.8rem;" onclick="creerOuModifierSection(true)">+ Nouveau</button>
                        <button class="back-btn" style="margin:0; flex:1; padding:6px; font-size:0.8rem;" onclick="creerOuModifierSection(false)">✏️ Texte</button>
                    </div>
                </div>

                <!-- Colonne Catégorie -->
                <div style="background:rgba(15,23,42,0.5); padding:15px; border-radius:10px; border:1px solid var(--border-color);">
                    <label style="font-size:0.8rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">2. Palier (Catégorie)</label>
                    <select class="form-input" style="margin:8px 0;" onchange="changerSelectionProf('cat', this.value)">
                        ${secObj.categories.map((c, i) => `<option value="${i}" ${i === admCatIdx ? 'selected' : ''}>${c.nom}</option>`).join('')}
                    </select>
                    <div style="display:flex; gap:6px;">
                        <button class="back-btn" style="margin:0; flex:1; padding:6px; font-size:0.8rem;" onclick="creerOuModifierCategorie(true)">+ Nouveau</button>
                        ${catObj ? `<button class="back-btn" style="margin:0; flex:1; padding:6px; font-size:0.8rem;" onclick="creerOuModifierCategorie(false)">✏️ Renommer</button>` : ''}
                    </div>
                </div>

                <!-- Colonne Chapitre -->
                <div style="background:rgba(15,23,42,0.5); padding:15px; border-radius:10px; border:1px solid var(--border-color);">
                    <label style="font-size:0.8rem; color:var(--text-muted); font-weight:600; text-transform:uppercase;">3. Chapitre</label>
                    <select class="form-input" style="margin:8px 0;" onchange="changerSelectionProf('chap', this.value)">
                        ${catObj && catObj.chapitres.length > 0 
                            ? catObj.chapitres.map((ch, i) => `<option value="${i}" ${i === admChapIdx ? 'selected' : ''}>${ch.titre}</option>`).join('')
                            : `<option value="">(Aucun chapitre)</option>`}
                    </select>
                    <div style="display:flex; gap:6px;">
                        <button class="back-btn" style="margin:0; flex:1; padding:6px; font-size:0.8rem;" onclick="creerNouveauChapitre()">+ Nouveau chapitre</button>
                        ${chapObj ? `<button class="logout-btn" style="padding:6px 10px;" onclick="supprimerChapitreActuel()" title="Supprimer ce chapitre">🗑️</button>` : ''}
                    </div>
                </div>

            </div>
        </div>

        <!-- 2. CONTENU DU CHAPITRE SÉLECTIONNÉ -->
        ${!chapObj ? `
            <div class="content-box" style="text-align:center; padding:50px;">
                <p style="color:var(--text-muted);">Aucun chapitre dans cette catégorie. Cliquez sur <b>"+ Nouveau chapitre"</b> ci-dessus pour commencer.</p>
            </div>
        ` : `
            <div class="content-box" style="margin-bottom:25px; padding:25px 30px;">
                <div class="breadcrumb">2. Réglages du chapitre : ${chapObj.titre}</div>
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-top:10px;">
                    <div class="form-group" style="margin:0;">
                        <label>Titre du chapitre</label>
                        <input type="text" id="edit-chap-titre" class="form-input" value="${echapperAttr(chapObj.titre)}" onchange="sauverInfosChapitre()">
                    </div>
                    <div class="form-group" style="margin:0;">
                        <label>🔒 Chapitre prérequis (pour débloquer les exercices)</label>
                        <select id="edit-chap-prereq" class="form-input" onchange="sauverInfosChapitre()">
                            <option value="">Aucun prérequis (Toujours débloqué)</option>
                            ${tousLesChapitres.map(c => `<option value="${c.id}" ${chapObj.prerequis === c.id ? 'selected' : ''}>${c.titre}</option>`).join('')}
                        </select>
                    </div>
                </div>
                <div class="form-group" style="margin-top:12px; margin-bottom:0;">
                    <label>Courte description du chapitre (affichée sur la carte)</label>
                    <input type="text" id="edit-chap-desc" class="form-input" value="${echapperAttr(chapObj.description || '')}" onchange="sauverInfosChapitre()">
                </div>
            </div>

            <!-- GRILLE : COURS À GAUCHE / EXERCICES À DROITE -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:25px;">
                
                <!-- LISTE DES COURS -->
                <div class="content-box" style="padding:25px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0;">📘 Points théoriques (${(chapObj.theorie || []).length})</h3>
                        <button class="btn-primary" style="width:auto; padding:8px 14px; font-size:0.85rem;" onclick="ouvrirEditeurCours(-1)">+ Ajouter un cours</button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${(chapObj.theorie || []).length === 0 ? `<p style="color:var(--text-muted); font-size:0.9rem;">Aucun point théorique dans ce chapitre.</p>` : ''}
                        ${(chapObj.theorie || []).map((th, idx) => `
                            <div style="background:rgba(15,23,42,0.6); border:1px solid var(--border-color); border-radius:10px; padding:12px 15px; display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-weight:500; font-size:0.95rem;">${th.titre}</span>
                                <div style="display:flex; gap:6px;">
                                    <button class="back-btn" style="margin:0; padding:4px 8px;" onclick="deplacerElement('theorie', ${idx}, -1)" title="Monter">↑</button>
                                    <button class="back-btn" style="margin:0; padding:4px 8px;" onclick="deplacerElement('theorie', ${idx}, 1)" title="Descendre">↓</button>
                                    <button class="back-btn" style="margin:0; padding:4px 10px; color:#818cf8; border-color:#818cf8;" onclick="ouvrirEditeurCours(${idx})">✏️ Modifier</button>
                                    <button class="logout-btn" style="padding:4px 8px;" onclick="supprimerElement('theorie', ${idx})">🗑️</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- LISTE DES EXERCICES -->
                <div class="content-box" style="padding:25px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                        <h3 style="margin:0;">🎯 Exercices (${(chapObj.exercices || []).length})</h3>
                        <button class="btn-primary" style="width:auto; padding:8px 14px; font-size:0.85rem;" onclick="ouvrirEditeurExercice(-1)">+ Ajouter un exercice</button>
                    </div>
                    <div style="display:flex; flex-direction:column; gap:10px;">
                        ${(chapObj.exercices || []).length === 0 ? `<p style="color:var(--text-muted); font-size:0.9rem;">Aucun exercice dans ce chapitre.</p>` : ''}
                        ${(chapObj.exercices || []).map((exo, idx) => `
                            <div style="background:rgba(15,23,42,0.6); border:1px solid var(--border-color); border-radius:10px; padding:12px 15px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
                                <div style="overflow:hidden;">
                                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                                        <span class="score-badge" style="padding:2px 8px; font-size:0.75rem;">Exo ${exo.numero} (${exo.points} pts)</span>
                                        <span style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase;">${exo.type === 'qcm' ? '☑️ QCM' : '✍️ LaTeX'}</span>
                                    </div>
                                    <div style="font-size:0.85rem; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:240px;">
                                        ${exo.enonce.replace(/<[^>]*>?/gm, '')}
                                    </div>
                                </div>
                                <div style="display:flex; gap:6px; flex-shrink:0;">
                                    <button class="back-btn" style="margin:0; padding:4px 8px;" onclick="deplacerElement('exercices', ${idx}, -1)" title="Monter">↑</button>
                                    <button class="back-btn" style="margin:0; padding:4px 8px;" onclick="deplacerElement('exercices', ${idx}, 1)" title="Descendre">↓</button>
                                    <button class="back-btn" style="margin:0; padding:4px 10px; color:#818cf8; border-color:#818cf8;" onclick="ouvrirEditeurExercice(${idx})">✏️ Modifier</button>
                                    <button class="logout-btn" style="padding:4px 8px;" onclick="supprimerElement('exercices', ${idx})">🗑️</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

            </div>
        `}

        <!-- 3. SAUVEGARDE / EXPORT SUR L'ORDINATEUR -->
        <div style="margin-top:30px; text-align:right;">
            <button class="back-btn" style="font-size:0.8rem;" onclick="exporterSauvegardeJson()">⬇️ Télécharger une copie de sauvegarde (.json)</button>
        </div>
    `;

    rendreLatex();
}

function changerSelectionProf(type, val) {
    if (type === 'sec') { admSec = val; admCatIdx = 0; admChapIdx = 0; }
    if (type === 'cat') { admCatIdx = parseInt(val); admChapIdx = 0; }
    if (type === 'chap') { admChapIdx = parseInt(val); }
    afficherTableauDeBordProf();
}

async function sauverInfosChapitre() {
    const chap = adminFullData[admSec].categories[admCatIdx].chapitres[admChapIdx];
    chap.titre = document.getElementById('edit-chap-titre').value.trim() || "Chapitre sans titre";
    chap.prerequis = document.getElementById('edit-chap-prereq').value || null;
    chap.description = document.getElementById('edit-chap-desc').value.trim();
    await sauvegarderSilence();
}

// Création / Modification de Sections, Catégories, Chapitres
async function creerOuModifierSection(nouveau) {
    if (nouveau) {
        const titre = prompt("Nom du nouveau domaine (ex: Arithmétique, Combinatoire) :");
        if (!titre) return;
        const cle = titre.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "") + "_" + Date.now().toString().slice(-3);
        const intro = prompt("Texte d'introduction de cette section :", "") || "";
        adminFullData[cle] = {
            titre: titre,
            intro: intro,
            categories: [{ nom: "Les essentiels", sousTitre: "Les bases indispensables.", chapitres: [] }]
        };
        admSec = cle; admCatIdx = 0; admChapIdx = 0;
    } else {
        const sec = adminFullData[admSec];
        const titre = prompt("Modifier le titre de la section :", sec.titre);
        if (!titre) return;
        const intro = prompt("Modifier le texte d'introduction :", sec.intro || "");
        sec.titre = titre;
        if (intro !== null) sec.intro = intro;
    }
    await sauvegarderSilence();
    afficherTableauDeBordProf();
}

async function creerOuModifierCategorie(nouveau) {
    const sec = adminFullData[admSec];
    if (nouveau) {
        const nom = prompt("Nom du nouveau palier (ex: Les classiques, Niveau Olympiades...) :");
        if (!nom) return;
        const sousTitre = prompt("Sous-titre descriptif :", "") || "";
        sec.categories.push({ nom, sousTitre, chapitres: [] });
        admCatIdx = sec.categories.length - 1;
        admChapIdx = 0;
    } else {
        const cat = sec.categories[admCatIdx];
        const nom = prompt("Renommer ce palier :", cat.nom);
        if (!nom) return;
        const sousTitre = prompt("Modifier le sous-titre :", cat.sousTitre || "");
        cat.nom = nom;
        if (sousTitre !== null) cat.sousTitre = sousTitre;
    }
    await sauvegarderSilence();
    afficherTableauDeBordProf();
}

async function creerNouveauChapitre() {
    const titre = prompt("Titre du nouveau chapitre :");
    if (!titre) return;
    const cat = adminFullData[admSec].categories[admCatIdx];
    cat.chapitres.push({
        id: 'chap_' + Date.now(),
        titre: titre,
        prerequis: null,
        description: "Description du chapitre...",
        theorie: [],
        exercices: []
    });
    admChapIdx = cat.chapitres.length - 1;
    await sauvegarderSilence();
    afficherTableauDeBordProf();
}

async function supprimerChapitreActuel() {
    const chap = adminFullData[admSec].categories[admCatIdx].chapitres[admChapIdx];
    if (!confirm(`Voulez-vous vraiment supprimer le chapitre "${chap.titre}" et tout son contenu ?`)) return;
    adminFullData[admSec].categories[admCatIdx].chapitres.splice(admChapIdx, 1);
    admChapIdx = 0;
    await sauvegarderSilence();
    afficherTableauDeBordProf();
}

async function deplacerElement(typeListe, idx, direction) {
    const chap = adminFullData[admSec].categories[admCatIdx].chapitres[admChapIdx];
    const liste = chap[typeListe];
    const nouvIdx = idx + direction;
    if (nouvIdx < 0 || nouvIdx >= liste.length) return;
    const temp = liste[idx];
    liste[idx] = liste[nouvIdx];
    liste[nouvIdx] = temp;
    // Renuméroter les exercices automatiquement (1, 2, 3...)
    if (typeListe === 'exercices') {
        liste.forEach((e, i) => e.numero = i + 1);
    }
    await sauvegarderSilence();
    afficherTableauDeBordProf();
}

async function supprimerElement(typeListe, idx) {
    const chap = adminFullData[admSec].categories[admCatIdx].chapitres[admChapIdx];
    if (!confirm("Confirmer la suppression ?")) return;
    chap[typeListe].splice(idx, 1);
    if (typeListe === 'exercices') {
        chap.exercices.forEach((e, i) => e.numero = i + 1);
    }
    await sauvegarderSilence();
    afficherTableauDeBordProf();
}

// =========================================================================
// ÉDITEUR VISUEL DE COURS (AVEC APERÇU LATEX EN DIRECT)
// =========================================================================
function ouvrirEditeurCours(idx) {
    const chap = adminFullData[admSec].categories[admCatIdx].chapitres[admChapIdx];
    const estNouveau = (idx === -1);
    const th = estNouveau ? {
        id: 'th_' + Date.now(),
        titre: `${(chap.theorie || []).length + 1}. Titre du point théorique`,
        contenu: `<h2>Titre principal</h2>\n<p>Écrivez votre cours ici. Utilisez $x^2 + 1$ pour des maths dans le texte, ou :</p>\n<div class="theorem-box">\n  <strong>Théorème :</strong> Pour tout réel $x$, on a :\n  $$x^2 \\ge 0$$\n</div>`
    } : chap.theorie[idx];

    const container = document.getElementById('main-container');
    container.innerHTML = `
        <button class="back-btn" onclick="afficherTableauDeBordProf()">← Annuler et revenir au chapitre</button>
        <div class="content-box">
            <div class="breadcrumb">${chap.titre} — ${estNouveau ? 'Nouveau Cours' : 'Modification du cours'}</div>
            
            <div class="form-group">
                <label>Titre du point théorique (affiché dans la liste du chapitre)</label>
                <input type="text" id="ed-th-titre" class="form-input" value="${echapperAttr(th.titre)}">
            </div>

            <!-- Barres d'outils rapides pour insérer des boîtes sans connaître le HTML -->
            <div style="margin-bottom:8px; display:flex; gap:8px; flex-wrap:wrap;">
                <span style="font-size:0.8rem; color:var(--text-muted); align-self:center;">Insérer rapidement :</span>
                <button type="button" class="back-btn" style="margin:0; padding:4px 10px; font-size:0.8rem;" onclick="insererBaliseCours('<h2>Sous-titre</h2>\\n')">Sous-titre</button>
                <button type="button" class="back-btn" style="margin:0; padding:4px 10px; font-size:0.8rem;" onclick="insererBaliseCours('<p>Paragraphe...</p>\\n')">Paragraphe</button>
                <button type="button" class="back-btn" style="margin:0; padding:4px 10px; font-size:0.8rem; color:#818cf8;" onclick="insererBaliseCours('<div class=\\'theorem-box\\'>\\n  <strong>Théorème :</strong> ...\\n</div>\\n')">Boîte Théorème / Propriété</button>
                <button type="button" class="back-btn" style="margin:0; padding:4px 10px; font-size:0.8rem;" onclick="insererBaliseCours('$$\\n  a^2 + b^2 = c^2\\n$$\\n')">Formule centrée $$...$$</button>
            </div>

            <!-- Éditeur Côte à Côte -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; align-items:stretch;">
                <div>
                    <label style="font-size:0.8rem; color:var(--text-muted);">Texte LaTeX / HTML :</label>
                    <textarea id="ed-th-contenu" class="admin-textarea" style="height:360px; margin-top:6px;" oninput="majApercuCours()">${th.contenu}</textarea>
                </div>
                <div>
                    <label style="font-size:0.8rem; color:var(--text-muted);">Aperçu élève en direct :</label>
                    <div id="ed-th-apercu" style="height:360px; overflow-y:auto; background:var(--bg-dark); border:1px solid var(--border-color); border-radius:8px; padding:20px; margin-top:6px;"></div>
                </div>
            </div>

            <button class="btn-primary" style="margin-top:15px;" onclick="enregistrerCours(${idx}, '${th.id}')">💾 Enregistrer ce cours</button>
        </div>
    `;

    majApercuCours();
}

function insererBaliseCours(code) {
    const ta = document.getElementById('ed-th-contenu');
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    ta.value = ta.value.substring(0, start) + code + ta.value.substring(end);
    ta.focus();
    majApercuCours();
}

function majApercuCours() {
    const code = document.getElementById('ed-th-contenu').value;
    const apercu = document.getElementById('ed-th-apercu');
    apercu.innerHTML = code;
    if (window.renderMathInElement) {
        renderMathInElement(apercu, {
            delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}]
        });
    }
}

async function enregistrerCours(idx, idExistant) {
    const chap = adminFullData[admSec].categories[admCatIdx].chapitres[admChapIdx];
    const titre = document.getElementById('ed-th-titre').value.trim();
    const contenu = document.getElementById('ed-th-contenu').value;
    if (!titre) return alert("Veuillez donner un titre au cours.");

    const objetCours = { id: idExistant, titre, contenu };
    if (idx === -1) chap.theorie.push(objetCours);
    else chap.theorie[idx] = objetCours;

    await sauvegarderSilence();
    afficherTableauDeBordProf();
}

// =========================================================================
// ÉDITEUR VISUEL D'EXERCICE (LATEX OU QCM + APERÇU EN DIRECT)
// =========================================================================
function ouvrirEditeurExercice(idx) {
    const chap = adminFullData[admSec].categories[admCatIdx].chapitres[admChapIdx];
    const estNouveau = (idx === -1);
    const exo = estNouveau ? {
        id: 'exo_' + Date.now(),
        numero: (chap.exercices || []).length + 1,
        points: 5,
        type: 'latex',
        enonce: "Factoriser dans $\\mathbb{R}$ l'expression $x^2 - 16$.",
        reponsesValides: ["(x-4)(x+4)", "(x+4)(x-4)"],
        options: [
            { texte: "Réponse A", correct: true },
            { texte: "Réponse B", correct: false },
            { texte: "Réponse C", correct: false }
        ],
        indiceErreur: "Utilisez l'identité remarquable $a^2 - b^2$."
    } : chap.exercices[idx];

    const optionsQcm = exo.options || [
        { texte: "Proposition A", correct: true },
        { texte: "Proposition B", correct: false },
        { texte: "Proposition C", correct: false },
        { texte: "Proposition D", correct: false },
        { texte: "Proposition E", correct: false }
    ];
    while (optionsQcm.length < 5) optionsQcm.push({ texte: "", correct: false });

    const container = document.getElementById('main-container');
    container.innerHTML = `
        <button class="back-btn" onclick="afficherTableauDeBordProf()">← Annuler et revenir au chapitre</button>
        <div class="content-box">
            <div class="breadcrumb">${chap.titre} — ${estNouveau ? 'Nouvel Exercice' : `Modification de l'exercice ${exo.numero}`}</div>
            
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom:15px;">
                <div class="form-group" style="margin:0;">
                    <label>Format de l'exercice</label>
                    <select id="ed-exo-type" class="form-input" onchange="basculerFormatExo()">
                        <option value="latex" ${exo.type === 'latex' ? 'selected' : ''}>✍️ Boîte de réponse mathématique (LaTeX)</option>
                        <option value="qcm" ${exo.type === 'qcm' ? 'selected' : ''}>☑️ QCM (Choix multiples)</option>
                    </select>
                </div>
                <div class="form-group" style="margin:0;">
                    <label>Nombre de points attribués</label>
                    <input type="number" id="ed-exo-pts" class="form-input" value="${exo.points || 5}">
                </div>
            </div>

            <!-- Énoncé Côte à Côte avec Aperçu -->
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
                <div>
                    <label style="font-size:0.85rem; color:var(--text-muted);">Énoncé de l'exercice (LaTeX $...$ et $$...$$ acceptés) :</label>
                    <textarea id="ed-exo-enonce" class="admin-textarea" style="height:130px; margin-top:6px;" oninput="majApercuExo()">${exo.enonce}</textarea>
                </div>
                <div>
                    <label style="font-size:0.85rem; color:var(--text-muted);">Aperçu de l'énoncé en direct :</label>
                    <div id="ed-exo-apercu" style="height:130px; overflow-y:auto; background:var(--bg-dark); border:1px solid var(--border-color); border-radius:8px; padding:15px; margin-top:6px;"></div>
                </div>
            </div>

            <!-- ZONE SPÉCIFIQUE : LATEX -->
            <div id="zone-ed-latex" style="display:${exo.type === 'latex' ? 'block' : 'none'}; background:rgba(15,23,42,0.5); padding:20px; border-radius:12px; margin-bottom:20px;">
                <label style="font-weight:600; color:#818cf8; display:block; margin-bottom:6px;">Réponses mathématiques acceptées (1 par ligne ou séparées par des virgules)</label>
                <p style="font-size:0.8rem; color:var(--text-muted); margin-top:0;">Les espaces et signes de multiplication sont automatiquement ignorés. Exemple : <code>(x-4)(x+4), (x+4)(x-4)</code></p>
                <textarea id="ed-exo-reponses" class="admin-textarea" style="min-height:80px; margin-bottom:0;">${(exo.reponsesValides || []).join(', ')}</textarea>
            </div>

            <!-- ZONE SPÉCIFIQUE : QCM -->
            <div id="zone-ed-qcm" style="display:${exo.type === 'qcm' ? 'block' : 'none'}; background:rgba(15,23,42,0.5); padding:20px; border-radius:12px; margin-bottom:20px;">
                <label style="font-weight:600; color:#818cf8; display:block; margin-bottom:10px;">Propositions du QCM (Cochez la bonne réponse à gauche, laissez vides les lignes inutilisées)</label>
                ${optionsQcm.map((opt, i) => `
                    <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
                        <input type="radio" name="qcm-correct" value="${i}" ${opt.correct ? 'checked' : ''} style="transform:scale(1.3); cursor:pointer;">
                        <span style="font-weight:600; width:22px;">${['A','B','C','D','E'][i]}</span>
                        <input type="text" class="form-input qcm-opt-input" value="${echapperAttr(opt.texte)}" placeholder="Texte ou formule LaTeX $...$ de l'option ${['A','B','C','D','E'][i]}">
                    </div>
                `).join('')}
            </div>

            <div class="form-group">
                <label>💡 Indice affiché à l'élève s'il se trompe (LaTeX accepté)</label>
                <input type="text" id="ed-exo-indice" class="form-input" value="${echapperAttr(exo.indiceErreur || '')}" placeholder="Ex: Pensez à calculer le discriminant Δ = b² - 4ac...">
            </div>

            <button class="btn-primary" onclick="enregistrerExercice(${idx}, '${exo.id}', ${exo.numero})">💾 Enregistrer cet exercice</button>
        </div>
    `;

    majApercuExo();
}

function basculerFormatExo() {
    const type = document.getElementById('ed-exo-type').value;
    document.getElementById('zone-ed-latex').style.display = (type === 'latex') ? 'block' : 'none';
    document.getElementById('zone-ed-qcm').style.display = (type === 'qcm') ? 'block' : 'none';
}

function majApercuExo() {
    const code = document.getElementById('ed-exo-enonce').value;
    const apercu = document.getElementById('ed-exo-apercu');
    apercu.innerHTML = code;
    if (window.renderMathInElement) {
        renderMathInElement(apercu, {
            delimiters: [{left: '$$', right: '$$', display: true}, {left: '$', right: '$', display: false}]
        });
    }
}

async function enregistrerExercice(idx, idExistant, numeroExistant) {
    const chap = adminFullData[admSec].categories[admCatIdx].chapitres[admChapIdx];
    const type = document.getElementById('ed-exo-type').value;
    const points = parseInt(document.getElementById('ed-exo-pts').value) || 5;
    const enonce = document.getElementById('ed-exo-enonce').value.trim();
    const indiceErreur = document.getElementById('ed-exo-indice').value.trim();

    if (!enonce) return alert("Veuillez écrire un énoncé.");

    const nouvelExo = { id: idExistant, numero: numeroExistant, points, type, enonce, indiceErreur };

    if (type === 'latex') {
        const rawReps = document.getElementById('ed-exo-reponses').value;
        const reponsesValides = rawReps.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);
        if (reponsesValides.length === 0) return alert("Veuillez indiquer au moins une réponse valide.");
        nouvelExo.reponsesValides = reponsesValides;
    } else {
        const inputs = document.querySelectorAll('.qcm-opt-input');
        const radios = document.querySelectorAll('input[name="qcm-correct"]');
        const options = [];
        inputs.forEach((inp, i) => {
            if (inp.value.trim() !== "") {
                options.push({ texte: inp.value.trim(), correct: radios[i].checked });
            }
        });
        if (options.length < 2) return alert("Veuillez remplir au moins 2 propositions pour le QCM.");
        if (!options.some(o => o.correct)) options[0].correct = true;
        nouvelExo.options = options;
    }

    if (idx === -1) chap.exercices.push(nouvelExo);
    else chap.exercices[idx] = nouvelExo;

    await sauvegarderSilence();
    afficherTableauDeBordProf();
}

// =========================================================================
// SUIVI DES ÉLÈVES & EXPORT DE SAUVEGARDE
// =========================================================================
async function afficherSuiviElevesProf() {
    const container = document.getElementById('main-container');
    const { data: historique } = await db.from('reponses_eleves').select('*').order('created_at', { ascending: false }).limit(100);

    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
            <button class="back-btn" style="margin:0;" onclick="afficherSection(sectionActuelle)">← Quitter le Mode Prof</button>
            <div style="display:flex; gap:10px;">
                <button class="nav-btn" onclick="afficherTableauDeBordProf()">📚 Gérer les Cours & Exos</button>
                <button class="nav-btn active" onclick="afficherSuiviElevesProf()">📊 Résultats des Élèves</button>
            </div>
        </div>

        <div class="content-box">
            <div class="breadcrumb">Suivi en temps réel</div>
            <h2>Les 100 dernières tentatives des élèves</h2>
            <table class="admin-table">
                <thead><tr><th>Élève</th><th>Exercice</th><th>Réponse tapée</th><th>Statut</th><th>Date & Heure</th></tr></thead>
                <tbody>
                    ${(historique || []).map(h => `
                        <tr>
                            <td><b>👤 ${echapperHtml(h.identifiant_eleve)}</b></td>
                            <td>${echapperHtml(h.question_id)}</td>
                            <td><code>${echapperHtml(h.reponse_donnee)}</code></td>
                            <td style="color:${h.est_correct ? '#34d399' : '#f87171'}; font-weight:600;">${h.est_correct ? '✔ Réussi' : '✘ Essai faux'}</td>
                            <td style="color:var(--text-muted);">${new Date(h.created_at).toLocaleString('fr-FR')}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function exporterSauvegardeJson() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(adminFullData, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", "sauvegarde_olympiades_" + new Date().toISOString().slice(0,10) + ".json");
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
}

function echapperAttr(str) {
    return (str || '').replace(/"/g, '&quot;');
}

function echapperHtml(str) {
    return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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
    for (const cat of (CONTENU_SITE[secKey]?.categories || [])) {
        for (const chap of (cat.chapitres || [])) {
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