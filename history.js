myUserId = 0
all_my_tournaments = {}
active_players = {}
my_pid_by_organizer = {}
all_data = {
	user: {},
	arena: {},
	tournament: {},
	game: {}
}

// log('history begin')


let limit_period = 1100;
let limit_prev = 0  // initially wrong, but irrelevant when filled with the same values anyway
let limit_phase = 0;
let limit_last = new Array(10).fill(-limit_period);
let limit_min_step = 10  // probably unnecessary
async function rate_limit() {
    let now = performance.now()
    let next_call = Math.max(
        now,
        limit_last[limit_phase] + limit_period,
        limit_last[limit_prev] + limit_min_step
    )
    limit_last[limit_phase] = next_call
    limit_prev = limit_phase
    limit_phase = (limit_phase+1) % limit_last.length
    let wait = next_call - now
	await new Promise(resolve => setTimeout(resolve, wait));
    return wait
}

async function get(options) {
    const headers = new Headers();
	
    headers.set('Authorization', `Bearer ${token}`);
	headers.set('Content-Type', 'application/json');
	headers.set('Accept', 'application/json');

	const opts = {
		headers: headers,
	};

	base_url = 'https://app.matchplay.events/api/'
	let request_url = base_url + options.endpoint

	if (options.query) {
		request_url += '?' + new URLSearchParams(options.query).toString();
	}
	const req = new Request(request_url, opts);

	let waited = await rate_limit()
	
	try {
		const response = await fetch(req);
		if (!response.ok) {
			alert('error 39')
			log(`${response.url} error: ${response.status}\n${response.headers}\n\n${response.body}`)
			throw new Error(`Response status: ${response.status}`);
		}
		const json = await response.json();
		return json.data
	} catch (error) {
		alert('error 57')
		catcher(error)
	}
}

async function get_me() {
	let data = await get({
		endpoint: 'users/profile'
	});
	myUserId = data.userId;
}

async function get_all_my_tournaments() {
	all_my_tournaments = {};
	for (tournament of (await get_tournaments(myUserId))) {
		add_tournament(tournament);
		all_my_tournaments[tournament.tournamentId] = tournament;
	}
}

async function get_tournaments(uid) {  // paginate
	let data = await get({
		endpoint: 'tournaments',
		query: {played: uid}
	});
	for (tournament of data) {
		save_data('tournament', tournament);
	};
	return data;
}
async function get_games_from_tournaments(tournaments) {
	let tids = [];
	for (tid in tournaments) {  // parallelize
		tids.push(tid);
	}
	// for (tid of tids) {
		// log(`populating games from tid ${tid}`)
		// get_and_populate_games_from_tournament(tid);
	// }
	const promises = tids.map(get_and_populate_games_from_tournament);
	await Promise.all(promises);
}
async function get_and_populate_games_from_tournament(tid) {
	let tournament = all_data.tournament[tid]
	// log(`getting games from tournament ${tournament}`)
	let tournament_games = await get_games_from_tournament(tournament)
	for (game of tournament_games) {
		// log(game.userIds);
		for (uid of game.userIds) {
			// log(uid);
			if (uid == myUserId) {
				// log('skipping, that is me')
				continue
			}
			if (active_players[uid]) {
				// log(`uid ${uid} is found in active_players: ${stringify(active_players)}`)
				let won = did_i_win(game, uid)
				if (won) {
					winloss[uid].won ++;
				} else {
					winloss[uid].lost ++;
				}
				update_player_standing(uid)
				add_player_game({
					uid: uid,
					game: game,
					won: won,
					order: -tid
				})
			};
		};
	};
	let listnode = document.querySelector(`#player-histories div.player-history div.merged-tournaments`);
	listnode.querySelector(`[data-kind="tournament"][data-id="${tid}"]`).remove();
	if (listnode.innerHTML == '') listnode.remove()
}
async function get_games_from_tournament(tournament, add_players) {
	// log(`doing get_games_from_tournament, active players  ${stringify(active_players)}`)
	let tid = tournament.tournamentId;
	if (!tid) {
		throw Error(`no tournamentId in ${stringify(tournament)} passed into get_games_from_tournament`)
	}
	let pid;
	if (my_pid_by_organizer[tid]) {
		pid = my_pid_by_organizer[tid];
		// log(`already knew my pid: ${pid}`);
	} else {
		pid = await get_tournament_details(tournament, add_players);
		// log(`my pid: ${pid}`);
		my_pid_by_organizer[tid] = pid;
	};
	let games = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	});
	// log(`got ${games.length} games`);
	for (game of games) {
		save_data('game', game);
	};
	return games;
}
async function get_tournament_details(tournament, add_players) {
	let tid = tournament.tournamentId;
	// log(`getting tournament ${tid} details`);
	if (!tournament) {
		throw Error('no tournament passed into get_tournament_details')
	}
	if (add_players) {
		fakefill(document.querySelector('#players'), true)
	}
	let tournament_details = await get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	});
	let pid;
	for (player of tournament_details.players) {
		let uid = player.claimedBy;
		if (uid == myUserId) {
			pid = player.playerId;
			continue;
		};
		if (!all_data.user[uid] && add_players) {
			all_data.user[uid] = player;
			// log(`adding player ${uid}`)
			add_player_button(uid);
		};
	};
	// log('adding arenas');
	for (arena of tournament_details.arenas) {
		save_data('arena', arena);
	};
	return pid;
}
async function get_other(id) {
	fakefill(document.querySelector('#active-games'), true)
	let tournament = all_data.tournament[id];
	active_players = {}
	let active_games = await get_games_from_tournament(tournament, true);
	// log(`active_games: ${active_games}`)
	active_games.reverse();
	let tit = document.querySelector('#active-tournament-title')
	tit.textContent = ''
	tit.append(title('tournament', tournament.tournamentId));
	for (game of active_games) {
		add_active_game(game);
	};
	document.querySelector('#active-tournament').scrollIntoView();
}
async function compare_players_from_game(id) {
	// log('welcome to compareplayersfromgame!')
	active_players = {};
	document.querySelector('#player-histories').innerHTML = '';  // or don't?
	winloss = {}
	// log(all_data.game);
	// log(id);
	// log(all_data.game[id]);
	let uids = all_data.game[id].userIds;
	// log(uids);
	for (uid of uids) {
		if (uid == myUserId) continue;
		// log(`adding ${uid} to active players`);
		if (add_active_player(uid)) {
			active_players[uid] = 1;
			// log(active_players);
		} else {
			// log(`${uid} already activated`)
		}
	};
	// log(`done compare_players_from_game, active players  ${stringify(active_players)}`)
	await merge_tournaments();
}
async function compare_player(id) {
	document.querySelector('#player-histories').innerHTML = ''
	active_players = {}
	active_players[id] = true
	if (add_active_player(id)) {
		await merge_tournaments()
	}
}
async function merge_tournaments() {
	document.querySelector('#player-histories').scrollIntoView();
	// log(`merge_tournaments, active players ${stringify(active_players)}`)
	let merged_tournaments = {};
	for (uid in active_players) {
		let tournaments = await get_tournaments(uid);
		// log(`${tournaments.length} tournaments`);
		for (tournament of tournaments) {
			let tid = tournament.tournamentId
			if (all_my_tournaments[tid]) {
				add_player_tournament(uid, tid)
				merged_tournaments[tid] = true
			}
		};
	};
	// log(merged_tournaments);
	// log(`merged tournaments: ${stringify(merged_tournaments)}`);
	await get_games_from_tournaments(merged_tournaments);
}
function rank(game, uid) {
	let playerId
	for (let i=0; i<game.userIds.length; i++) {
		let userId = game.userIds[i]
		if (userId == uid) {
			playerId = game.playerIds[i]
			break
		}
	}
	let result = game.resultPositions
	if (!result || !result.length) {
		result = game.suggestions[0].results
	}
	return result.indexOf(playerId) + 1
}
function did_i_win(game, uid) {
	return rank(game, myUserId) < rank(game, uid)
}
function rankiness(game) {
	let result = game.resultPositions
	if (!result || !result.length) {
		result = game.suggestions[0].results
	}
	return {
		place: rank(game, myUserId),
		players: result.length
	}
}
function token_needed(message) {
	document.querySelector('#token-entry').style.display = 'block';
	document.querySelector('#token-form').addEventListener('submit', async function (event) {
		event.preventDefault();
		token = document.querySelector('#token').val();
		localStorage.setItem('token', token);
		document.querySelector('#token-entry').style.display = 'none';
		main().catch(catcher);
	});
}
function premain() {
    token = localStorage.getItem('token');
	if (!token) {
		token_needed()
	} else {
		document.querySelector('#token-entry').style.display = 'none';
		main().catch(catcher);
	};
};
async function main() {
	await get_me();
	await get_all_my_tournaments();
}

////////////////////////////////////////////////////////////////

let ready = (callback) => {
	if (document.readyState != 'loading') {
		callback();
	} else {
		document.addEventListener('DOMCOntentLoaded', callback);
	}
}
ready(() => {
	try {
		premain();
	} catch (err) {
		catcher(err)
	}
});

function handler(callback) {
	let handle = async function () {
		try {
			for (child of this.parentNode.children) child.classList.remove('active')
				this.classList.add('active')
			let id = this.dataset.id
			await callback(id)
		} catch (err) {
			this.classList.remove('active')
			await catcher(err)
		}
	}
	return handle
}
function insertSorted(element, parent) {
	let added = false;
	let etext = element.textContent.toLowerCase();
	for (el of parent.children) {
		if ((el.textContent.toLowerCase()) > etext) {  // }.localeCompare(etext, 'en', {'sensitivity': 'base'})) {
			parent.insertBefore(element, el);
			added = true;
			return false;
		}
	};
	if(!added) parent.append(element);
}

function add_player_button(uid) {
	let button = title('user', uid);
	button.classList.add('box');
	button.addEventListener('click', handler(compare_player))
	insertSorted(button, document.querySelector('#players'));
}
function add_active_player(id) {
	let playerbox = document.querySelector(`#player-histories div.player-history[data-playerid="${uid}"]`)
	if (playerbox) {
		document.querySelector('#player-histories').prepend(playerbox);
		return false;
	};

	winloss[id] = {won: 0, lost: 0}

	playerbox = document.createElement('div')
	playerbox.classList.add('player-history')
	playerbox.dataset.playerid = id

	let h2 = document.createElement('h2')
	h2.classList.add('player-name')
	playerbox.prepend(h2)

	let vsBars = document.createElement('span')
	vsBars.classList.add('vs-bars')
	h2.append(vsBars)

	let vsText = document.createElement('span')
	vsText.classList.add('vs-text')
	vsText.innerHTML = '0 &mdash; 0 vs '
	h2.append(vsText)

	h2.append(title('user', id))

	let merged = document.createElement('div')
	merged.classList.add('merged-tournaments')
	playerbox.append(merged)
	
	let boxgroup = document.createElement('div')
	boxgroup.classList.add('boxgroup')
	playerbox.append(fakefill(boxgroup))

	document.querySelector('#player-histories').prepend(playerbox);
	return true
}
function add_player_tournament(uid, tid) {
	let trow = title('tournament', tid, 'div');
	trow.prepend('Loading ');
	trow.append('...');
	let selector = `#player-histories div.player-history[data-playerid="${uid}"] div.merged-tournaments`
	document.querySelector(selector).append(trow)
}

function title(kind, id, element_type) {
	let element = notitle(kind, id, element_type);
	element.classList.add(kind+'-name');
	let name;
	if (kind == 'user' && id == myUserId) {
		name = 'Me';
	} else {
		name = (all_data[kind][id] && all_data[kind][id].name) || (kind + id);
	}
	element.textContent = name;  // `${name} (${kind} ${id})`);
	return element;
}
function notitle(kind, id, element_type) {
	let element = document.createElement(element_type || 'span')
	element.dataset.kind = kind
	element.dataset.id = id
	return element;
}
function save_data(kind, obj) {
	let id = obj[kind+'Id'];
	if (!all_data[kind][id]) {
		//log(`${kind} ${id} already known. is this bad?`)
		all_data[kind][id] = obj;
		// log(`saved ${kind} ${id}`);
		if (obj.name) {
			for (obj of document.querySelectorAll(`.${kind}-name[data-id="${id}"`)) {
				obj.text(obj.name);
			}
		}
	}
}
function spacer() {
	let el = document.createElement('div')
	el.classList.add('spacer')
	return el
}
function update_player_standing(uid) {
	let won = winloss[uid].won
	let lost = winloss[uid].lost
	let parent = document.querySelector(`#player-histories div.player-history[data-playerid="${uid}"]`)
	let percent = won / (won+lost) * 100;

	parent.querySelector('.vs-bars').style.cssText = `--percent: ${percent}%`;
	parent.querySelector('.vs-text').innerHTML = `${won} &mdash; ${lost} vs `;
}
function add_player_game(options) {
	let box = game_element(options.game, false, true, options.won);
	box.style.order = options.order
	let parent = document.querySelector(`#player-histories div.player-history[data-playerid="${options.uid}"] .boxgroup`);
	parent.append(box);
}
function add_active_game(game) {
	let box = game_element(game, true, false);
	box.addEventListener('click', handler(compare_players_from_game))
	document.querySelector('#active-games').append(box);
}
function game_element(game, inc_players, inc_tournament, won) {
	// log(game);
	let box = notitle('game', game.gameId, 'div');
	let wordrank
	log(won)
	log(typeof won)
	if (typeof won == 'undefined') {
		let win_rank = rankiness(game)
		if (win_rank.place == 1) {
			box.classList.add('won');
			wordrank = '(won)'
		} else if (win_rank.place == win_rank.players) {
			box.classList.add('lost');
			wordrank = '(lost)'
		} else {
			wordrank = ['zero?', '1st', '2nd', '3rd', '4th', 'fifth?'][win_rank.place];
		}
	} else {
		if (won) {
			wordrank = '(won)'
		} else {
			wordrank = '(lost)'
		}
		box.classList.toggle('won', won);
		box.classList.toggle('lost', !won);
	}
	box.classList.add('box');
	let tit = title('arena', game.arenaId);
	tit.append(spacer());
	tit.append(wordrank);
	box.append(tit);
	box.append(spacer());
	if (inc_players) {
		let plist = document.createElement('ol');
		plist.classList.add('players');
		box.append(plist);
		for (uid of game.userIds) {
			let li = document.createElement('li');
			li.append(title('user', uid));
			plist.append(li);
		}
		box.append(spacer());
	}
	if (inc_tournament) {
		box.append(title('tournament', game.tournamentId));
	}
	return box;
}
function add_tournament(tournament) {
	let box = title('tournament', tournament.tournamentId);
	box.classList.add('box');
	box.addEventListener('click', handler(get_other))
	document.querySelector('#active-tournaments').append(box);
}
function fakefill(element, empty) {
	if (empty) element.innerHTML = '';
	for (i=0;i<10;i++) {
		let new_el = document.createElement('div');
		new_el.classList.add('fake', 'box');
		element.append(new_el);
	}
	return element;
}
// log('history end');
