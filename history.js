let myUserId = 0;
let all_my_tournaments = {};
let my_lowest_tournament;
let active_players = {};
let my_pid_by_organizer = {};
let active_tournament_id;
let refresh_timer;
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
	refresh_off()
	document.getElementById('active-tournament-block').style.display = 'none';
	document.getElementById('selected-game').innerHTML = '';
	document.getElementById('player-histories').innerHTML = '';

	document.getElementById('my-tournaments').classList.add('ready');
	all_my_tournaments = {};
	my_lowest_tournament = undefined
	let in_progress = []
	document.getElementById('my-tournaments').innerHTML = ''
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
	let tournament_games = (await get_games_from_tournament(tournament)).games;
	for (game of tournament_games) {
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
					update_player_standing(uid, document.getElementById('selected-game'))
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
		let result = await get_tournament_details(tournament);
		pid = result.pid
		my_pid_by_organizer[tid] = pid;

		if (add_players) {
			all_data.user = {};
			for (player of result.players) {
				let uid = player.claimedBy;
				if (uid == myUserId) {
					continue;
				};
				if (!all_data.user[uid]) {
					all_data.user[uid] = player;
					add_player_button(uid);
				}
			};
		}
	
	};
	let response = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	});
	let games = response.data
	let changes = 0;
	for (game of games) {
		changes += save_data('game', game);
	};
	return {games: games, changes: changes};
}
async function get_tournament_details(tournament) {
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
	let players = tournament_details.players;
	for (player of players) {
		if (player.claimedBy == myUserId) {
			pid = player.playerId;
			break;
		};
	}
	for (arena of tournament_details.arenas) {
		save_data('arena', arena);
	};
	return {pid: pid, players: players};
}
async function refresh_tournaments_click() {
	await get_all_my_tournaments()
}
function refresh_on() {
	refresh_timer = setTimeout(refresh_tournament_timer, 5000);
	let refresh_button = document.getElementById('refresh-active-tournament')
	refresh_button.style.minWidth = `${refresh_button.offsetWidth}px`
	refresh_button.classList.add('timed');
	refresh_button.querySelector('.text').textContent = 'live'
}
function refresh_off(will_refresh) {
	clearTimeout(refresh_timer)
	refresh_timer = null
	let refresh_button = document.getElementById('refresh-active-tournament')
	refresh_button.style.minWidth = `${refresh_button.offsetWidth}px`
	refresh_button.classList.remove('timed')
	refresh_button.querySelector('.text').textContent = will_refresh ? 'wait' : 'refresh'
}
async function refresh_tournament_click() {
	if (refresh_timer) {
		refresh_off()
	} else {
		refresh_tournament_timer()
	}
}
async function refresh_tournament_timer() {
	refresh_off(true)
	if (await do_refresh_tournament()) {
		refresh_on()
	} else {
		refresh_off()
	}
}
async function do_refresh_tournament() {
	let status = all_data.tournament[active_tournament_id].status
	let changes = await get_other()
	if (changes) {
		await flash_screen()
		return false
	} else {
		if (status !== 'completed') {
			return true
		} else {
			alert('No auto refresh for completed tournaments')
			return false
		}
	};
}
async function flash_screen() {
	for (let x=0; x<10;x++) {
		document.body.classList.add('flash')
		await new Promise(resolve => setTimeout(resolve, 200));
		document.body.classList.remove('flash')
		await new Promise(resolve => setTimeout(resolve, 200));
	}
}
async function get_other(id) {
	let refresh_players
	if (id) {
		active_tournament_id = id
		refresh_players = true
		document.getElementById('active-tournament').innerHTML = '';
	} else {
		// refreshing
		refresh_players = false
	}
	let tournament = all_data.tournament[active_tournament_id];

	active_players = {};

	let result = (await get_games_from_tournament(tournament, refresh_players));
	if (!refresh_players && !result.changes) return;

	let active_games = result.games
	active_games.reverse();

	document.getElementById('player-histories').innerHTML = ''
	document.getElementById('active-tournament-block').style.display = 'block'
	let title_h2 = document.getElementById('active-tournament-title');
	title_h2.innerHTML = '';
	title_h2.append(title('tournament', tournament.tournamentId, 'span'));

	let in_progress = []
	for (game of active_games) {
		let element = add_active_game(game);
		if (game.status != 'completed')  in_progress.push([game.status, element]);
	};
	document.getElementById('active-tournament-title').scrollIntoView();
	if (in_progress.length == 1) {
		let status = in_progress[0][0]
		let element = in_progress[0][1]
		element.dispatchEvent(new Event('click'))
		activate_tab(active_tournament_tab(status))
	}
	return in_progress.length;
}
async function compare_players_from_game(id) {
	active_players = {};
	let game = all_data.game[id]
	document.getElementById('player-histories').innerHTML = '';  // or don't?
	let selected = document.getElementById('selected-game');
	fakefill(selected)
	selected.append(game_element(game, true, false));
	winloss = {}
	let uids = game.userIds;
	for (const uid of uids) {
		if (uid == myUserId) continue;
		if (add_active_player(uid)) {
			active_players[uid] = 1;
		}
	};
	await merge_tournaments();
}
async function compare_player(id) {
	document.getElementById('player-histories').innerHTML = ''
	let selected = document.getElementById('selected-game');
	fakefill(selected)
	winloss = {}
	active_players = {}
	active_players[id] = true
	if (add_active_player(id)) {
		await merge_tournaments()
	}
}
async function merge_tournaments() {
	let tournaments
	document.getElementById('selected').scrollIntoView();
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
	document.getElementById('token-entry').style.display = 'block';
	if (message) document.getElementById('token-message').textContent = message;
	document.getElementById('token-form').addEventListener('submit', async function (event) {
		try {
			event.preventDefault();
			token = document.getElementById('token').value;
			localStorage.setItem('token', token);
			document.getElementById('token-entry').style.display = 'none';
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
		document.getElementById('token-entry').style.display = 'none';
		document.getElementById('main').style.display = 'block';
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
	document.getElementById('refresh-my-tournaments').addEventListener('click', handler(refresh_tournaments_click));
	document.getElementById('refresh-active-tournament').addEventListener('click', handler(refresh_tournament_click));
}
ready(() => {
	try {
		premain();
	} catch (err) {
		catcher(err)
	}
});

function handler(callback, id) {
	let handle = async function () {
		// log(id)
		try {
			let tabs = this.closest('.tabs')
			if (tabs) {
				for (child of tabs.querySelectorAll('.active')) child.classList.remove('active')
				this.classList.add('active')
			}
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
	button.addEventListener('click', handler(compare_player, uid))
	insertSorted(button, active_tournament_tab('players'));
}
function add_active_player(id) {
	let playerbox = document.querySelector(`#player-histories div.player-history[data-playerid="${id}"]`)
	if (playerbox) {
		document.getElementById('player-histories').prepend(playerbox);
		return false;
	};

	winloss[id] = {won: 0, lost: 0}

	playerbox = document.createElement('div')
	playerbox.classList.add('player-history')
	playerbox.dataset.playerid = id

	let h2 = document.createElement('h3')
	h2.classList.add('player-name')
	playerbox.prepend(h2)

	let vsBars = document.createElement('span')
	vsBars.classList.add('vs-bars')
	vsBars.dataset.uid = id
	h2.append(vsBars)

	let vsText = document.createElement('span')
	vsText.classList.add('vs-text')
	vsText.dataset.uid = id
	vsText.innerHTML = '0 &mdash; 0 vs '
	h2.append(vsText)

	h2.append(title('user', id, 'span'))

	let merged = document.createElement('div')
	merged.classList.add('merged-tournaments')
	playerbox.append(merged)
	
	let boxgroup = document.createElement('div')
	boxgroup.classList.add('boxgroup')
	playerbox.append(fakefill(boxgroup))

	document.getElementById('player-histories').prepend(playerbox);
	return true
}
function add_player_tournament(uid, tid) {
	let trow = title('tournament', tid);
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
		return 1
	} else {
		return 0
	}
}
function spacer() {
	let el = document.createElement('div');
	el.classList.add('spacer');
	return el
}
function update_player_standing(uid, parent) {
	let won = winloss[uid].won;
	let lost = winloss[uid].lost;
	let percent = won / (won+lost) * 100;
	
	if (!parent) {
		parent = document.querySelector(`#player-histories div.player-history[data-playerid="${uid}"]`);
	}

	let bar = parent.querySelector(`.vs-bars[data-uid="${uid}"]`);
	if (bar) {
		bar.style.cssText = `--percent: ${percent}%`;
		bar.classList.add('ready');
	}
	let text = parent.querySelector(`.vs-text[data-uid="${uid}"]`)
	if (text) text.innerHTML = `${won} &mdash; ${lost} vs `;
}
function add_player_game(options) {
	let box = game_element(options.game, false, true, options.won);
	box.style.order = options.order;
	let parent = document.querySelector(`#player-histories div.player-history[data-playerid="${options.uid}"] .boxgroup`);
	parent.append(box);
}
function add_active_game(game) {
	let box = game_element(game, true, false);
	box.addEventListener('click', handler(compare_players_from_game, game.gameId));
	active_tournament_tab(game.status).append(box);
	return box;
}
function game_element(game, inc_players, inc_tournament, won) {
	let box = notitle('game', game.gameId, 'div');
	let wordrank = game.status;
	if (typeof won == 'undefined') {
		// log(`won was ${wgon}`)
		let win_rank = rankiness(game);
		// log(`win_rank is ${stringify(win_rank)}`)
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
			// log(`setting won because ${won}`)
			wordrank = '(won)'
		} else {
			// log(`setting lost because ${won}`)
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
			let vsBar = document.createElement('span')
			vsBar.dataset.uid = uid
			vsBar.classList.add('vs-bars')
			li.append(vsBar)
			li.append(title('user', uid, 'span'));
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
	box.addEventListener('click', handler(get_other, tid))
	my_tournaments_tab(tournament.status).append(box);
	return box
}
function my_tournaments_tab(status) {
	return tab(document.getElementById('my-tournaments'), status)
}
function active_tournament_tab(status) {
	return tab(document.getElementById('active-tournament'), status)
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
function fakefill(element) {
	element.innerHTML = '';
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
			await Notification.requestPermission()
		}
		if (Notification.permission === "granted") {
			const notification = new Notification("Hi there!");
		} else {

		}
	}
  }
  
