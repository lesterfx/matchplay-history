let myUserId = 0
let all_my_tournaments = {}
let my_lowest_tournament
let active_players = {}
let my_pid_by_organizer = {}
let active_tournament_id
let all_data = {
	user: {},
	arena: {},
	tournament: {},
	game: {}
}

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
	while (1) {
		await rate_limit()
		try {
			const response = await fetch(req.clone());
			if (!response.ok) {
				if (response.status == 429) continue;
				log(`${response.url} error: ${response.status}\n${response.headers.toString()}\n\n${response.body.toString()}`)
				throw new Error(`Response status: ${response.status}`);
			}
			const json = await response.json();
			return json
		} catch (error) {
			catcher(error)
			break
		}
	}
}

async function get_me() {
	let response = await get({
		endpoint: 'users/profile'
	});
	myUserId = response.data.userId;
}

async function get_all_my_tournaments() {
	document.querySelector('#my-tournaments').classList.add('ready');
	all_my_tournaments = {};
	my_lowest_tournament = undefined
	let in_progress = []
	document.querySelector('#my-tournaments').innerHTML = ''
	let tournaments = await get_tournaments(myUserId);
	for (let tournament of tournaments) {
		let element = add_tournament(tournament);
		all_my_tournaments[tournament.tournamentId] = tournament;
		if (tournament.status != 'completed') in_progress.push([tournament.status, element])
	}
	if (in_progress.length == 1) {
		let status = in_progress[0][0]
		let element = in_progress[0][1]
		
		element.dispatchEvent(new Event('click'))
		activate_tab(my_tournaments_tab(status))
	}
}

async function* get_tournaments_paginated(uid) {  // paginate
	let query = {
		played: uid,
		page: 0 // increments before called
	}
	let need_more = true
	do {
		query['page'] ++;
		let response = await get({
			endpoint: 'tournaments',
			query: query
		});
		let data = response.data
		for (tournament of data) {
			if (tournament.tournamentId <= my_lowest_tournament) {
				need_more = false
			}
			if (query.page >= response.meta.last_page) {
				need_more = false
			}
			save_data('tournament', tournament);
		};
		yield data;
	} while (need_more)
}
async function get_tournaments(uid) {  // paginate
	let response = await get({
		endpoint: 'tournaments',
		query: {played: uid}
	});
	for (tournament of response.data) {
		save_data('tournament', tournament);
	};
	return response.data;
}
async function get_games_from_tournaments(tournaments) {
	let tids = [];
	for (tid in tournaments) {  // parallelize
		tids.push(tid);
	}
	const promises = tids.map(get_and_populate_games_from_tournament);
	await Promise.all(promises);
}
async function get_and_populate_games_from_tournament(tid) {
	let tournament = all_data.tournament[tid]
	let tournament_games = await get_games_from_tournament(tournament)
	for (game of tournament_games) {
	// 	if (Math.random() > 0.6) {
	// 		game.userIds = [35180,42410,27652,34922]
	// 		game.playerIds = [322136,390368,250886,320355]
	// 		game.resultPositions = [null, null, null, null]
	// 		game.suggestions = []
	// 	}
		for (uid of game.userIds) {
			if (uid == myUserId) {
				continue
			}
			if (active_players[uid]) {
				let won = did_i_win(game, uid)
				if (won !== null) {
					if (won) {
						winloss[uid].won ++;
					} else {
						winloss[uid].lost ++;
					}
					update_player_standing(uid)
				}
				add_player_game({
					uid: uid,
					game: game,
					won: won,
					order: -tid
				})
			};
		};
	};
	let listnodes = document.querySelectorAll(`#player-histories div.player-history div.merged-tournaments`);
	for (listnode of listnodes) {
		for (let node of listnode.querySelectorAll(`[data-kind="tournament"][data-id="${tid}"]`)) node.remove();
		if (listnode.innerHTML == '') listnode.remove()
	}
}
async function get_games_from_tournament(tournament, add_players) {
	let tid = tournament.tournamentId;
	if (!tid) {
		throw Error(`no tournamentId in ${stringify(tournament)} passed into get_games_from_tournament`)
	}
	let pid;
	if (my_pid_by_organizer[tid] && !add_players) {
		pid = my_pid_by_organizer[tid];
	} else {
		pid = await get_tournament_details(tournament, add_players);
		my_pid_by_organizer[tid] = pid;
	};
	let response = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	});
	let games = response.data
	for (game of games) {
		save_data('game', game);
	};
	return games;
}
async function get_tournament_details(tournament, add_players) {
	let tid = tournament.tournamentId;
	if (!tournament) {
		throw Error('no tournament passed into get_tournament_details')
	}
	let response = await get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	});
	let tournament_details = response.data;
	let pid;
	if (add_players) all_data.user = {};
	for (player of tournament_details.players) {
		let uid = player.claimedBy;
		if (uid == myUserId) {
			pid = player.playerId;
			continue;
		};
		if (add_players && !all_data.user[uid]) {
			all_data.user[uid] = player;
			add_player_button(uid);
		}
	};
	for (arena of tournament_details.arenas) {
		save_data('arena', arena);
	};
	return pid;
}
async function refresh_tournaments() {
	log(`refresh tournaments`)
	await get_all_my_tournaments()
}
async function refresh_tournament() {
	log(`refresh tournament ${active_tournament_id}`);
	// await notifyMe();
	let refresh_button = document.querySelector('#refresh-active-tournament')
	refresh_button.classList.remove('timed')
	await get_other();
	if (refresh_timer) clearTimeout(refresh_timer)
	refresh_timer = setTimeout(refresh_tournament, 5000);
	refresh_button.classList.add('timed');
}
async function get_other(id) {
	log(id)
	if (id) active_tournament_id = id
	let tournament = all_data.tournament[active_tournament_id];
	active_players = {};
	document.querySelector('#player-histories').innerHTML = ''
	let tabs = document.querySelector('#active-tournament');
	tabs.innerHTML = '';
	let title_h2 = document.querySelector('#active-tournament-title');
	title_h2.innerHTML = '';
	title_h2.append(title('tournament', tournament.tournamentId, 'span'));

	let active_games = await get_games_from_tournament(tournament, true);
	active_games.reverse();
	
	let in_progress = []
	for (game of active_games) {
		let element = add_active_game(game);
		if (game.status != 'completed')  in_progress.push([game.status, element]);
	};
	document.querySelector('#active-tournament-title').scrollIntoView();
	if (in_progress.length == 1) {
		let status = in_progress[0][0]
		let element = in_progress[0][1]
		element.dispatchEvent(new Event('click'))
		activate_tab(active_tournament_tab(status))
	}
}
async function compare_players_from_game(id) {
	active_players = {};
	document.querySelector('#player-histories').innerHTML = '';  // or don't?
	winloss = {}
	let uids = all_data.game[id].userIds;
	for (uid of uids) {
		if (uid == myUserId) continue;
		if (add_active_player(uid)) {
			active_players[uid] = 1;
		}
	};
	await merge_tournaments();
}
async function compare_player(id) {
	document.querySelector('#player-histories').innerHTML = ''
	winloss = {}
	active_players = {}
	active_players[id] = true
	if (add_active_player(id)) {
		await merge_tournaments()
	}
}
async function merge_tournaments() {
	let tournaments
	document.querySelector('#player-histories').scrollIntoView();
	let merged_tournaments = {};
	for (uid in active_players) {
		for await (tournaments of get_tournaments_paginated(uid)) {
			for (let tournament of tournaments) {
				let tid = tournament.tournamentId
				if (all_my_tournaments[tid]) {
					add_player_tournament(uid, tid)
					merged_tournaments[tid] = true
				}
			};
		};
	};
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
	if (!result || !result.length || result.includes(null)) {
		if (game.suggestions && game.suggestions.length) {
			result = game.suggestions[0].results
		} else {
			log('game has no resultPositions or suggestions')
			log(game)
			return null
		}
	}
	return result.indexOf(playerId)
}
function did_i_win(game, uid) {
	let me = rank(game, myUserId)
	let other = rank(game, uid)
	if (me === null || other === null) return null
	return me < other
}
function rankiness(game) {
	return {
		place: rank(game, myUserId),
		maxplace: game.userIds.length - 1
	}
}
function token_needed(message) {
	document.querySelector('#token-entry').style.display = 'block';
	if (message) document.querySelector('#token-message').textContent = message;
	document.querySelector('#token-form').addEventListener('submit', async function (event) {
		try {
			event.preventDefault();
			token = document.querySelector('#token').value;
			localStorage.setItem('token', token);
			document.querySelector('#token-entry').style.display = 'none';
			main().catch(catcher);
		} catch (err) {
			catcher(err)
		}
	});
}
function premain() {
    token = localStorage.getItem('token');
	if (!token) {
		token_needed('Log in by providing your Match Play API token')
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
	document.querySelector('#refresh-my-tournaments').addEventListener('click', handler(refresh_tournaments));
	document.querySelector('#refresh-active-tournament').addEventListener('click', handler(refresh_tournament));
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
			let tabs = this.closest('.tabs')
			if (tabs) {
				for (child of tabs.querySelectorAll('.active')) child.classList.remove('active')
				this.classList.add('active')
			}
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
	insertSorted(button, active_tournament_tab('players'));
}
function add_active_player(id) {
	let playerbox = document.querySelector(`#player-histories div.player-history[data-playerid="${id}"]`)
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

	h2.append(title('user', id, 'span'))

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
	let trow = title('tournament', tid);
	trow.prepend('Loading ');
	trow.append('...');
	let selector = `#player-histories div.player-history[data-playerid="${uid}"] div.merged-tournaments`
	document.querySelector(selector).append(trow)
}

function title(kind, id, element_type) {
	let element = notitle(kind, id, element_type);
	element.classList.add(kind+'-name');
	element.classList.add('title');
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
	let element = document.createElement(element_type || 'div')
	element.dataset.kind = kind
	element.dataset.id = id
	return element;
}
function save_data(kind, obj) {
	let id = obj[kind+'Id'];
	if (!all_data[kind][id]) {
		all_data[kind][id] = obj;
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
	parent.querySelector('.vs-bars').classList.add('ready')
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
	active_tournament_tab(game.status).append(box)
	return box
}
function game_element(game, inc_players, inc_tournament, won) {
	let box = notitle('game', game.gameId, 'div');
	let wordrank = game.status
	if (typeof won == 'undefined') {
		log(`won was ${won}`)
		let win_rank = rankiness(game)
		log(`win_rank is ${stringify(win_rank)}`)
		if (typeof win_rank != 'undefined') {
			let percent = win_rank.place / win_rank.maxplace * 100
			box.style.cssText = `--winmix: ${percent}%`;
			box.classList.add('winmix');
			wordrank = ['1st', '2nd', '3rd', '4th'][win_rank.place];
		} else {
			wordrank = stringify(win_rank)
		}
	} else if (won === null) {
	} else {
		if (won) {
			log(`setting won because ${won}`)
			wordrank = '(won)'
		} else {
			log(`setting lost because ${won}`)
			wordrank = '(lost)'
		}
		box.classList.toggle('won', won);
		box.classList.toggle('lost', !won);
	}
	box.classList.add('box');
	let tit = title('arena', game.arenaId);
	let wordspan = document.createElement('span');
	wordspan.textContent = wordrank;
	tit.append(wordspan);

	box.append(tit);
	if (inc_players) {
		let plist = document.createElement('ol');
		plist.classList.add('players');
		box.append(plist);
		for (uid of game.userIds) {
			let li = document.createElement('li');
			li.append(title('user', uid));
			plist.append(li);
		}
	}
	if (inc_tournament) {
		box.append(spacer());
		box.append(title('tournament', game.tournamentId));
	}
	return box;
}
function add_tournament(tournament) {
	let tid = tournament.tournamentId
	if (my_lowest_tournament) {
		my_lowest_tournament = Math.min(my_lowest_tournament, tid)
	} else {
		my_lowest_tournament = tid
	}
	let box = title('tournament', tid);
	box.classList.add('box');
	box.addEventListener('click', handler(get_other))
	my_tournaments_tab(tournament.status).append(box);
	return box
}
function my_tournaments_tab(status) {
	return tab(document.querySelector('#my-tournaments'), status)
}
function active_tournament_tab(status) {
	return tab(document.querySelector('#active-tournament'), status)
}
function activate_tab(boxgroup) {
	document.querySelector(`#${boxgroup.dataset.inputid}`).checked = true

}
function tab(parent, identifier) {
	let boxgroup = parent.querySelector('.boxgroup.' + `${parent.dataset.tabgroup}-${identifier}`)
	if (boxgroup) {
		return boxgroup
	}
	let id = `${parent.dataset.tabgroup}-${identifier}`

	let input_ = document.createElement('input')
	input_.type = 'radio'
	input_.name = parent.dataset.tabgroup
	input_.id = id
	input_.checked = true
	parent.append(input_)

	let label = document.createElement('label')
	label.setAttribute('for', id)
	label.textContent = identifier
	parent.append(label)

	let div = document.createElement('div')
	div.classList.add('clickables', 'boxgroup', id)
	div.dataset.inputid = id
	parent.append(div)

	fakefill(div)

	return div
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
async function notifyMe() {
	if (!('Notification' in window)) {
		log('This browser does not support desktop notification');
	} else {
		if (Notification.permission != 'granted' && Notification.permission != 'denied') {
			log('requesting permission')
			await Notification.requestPermission()
			log(`permission ${Notification.permission}`)
		}
		if (Notification.permission === "granted") {
			log('showing notificaiton!')
			const notification = new Notification("Hi there!");
		} else {

		}
	}
  }
  
