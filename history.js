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
let allow_refresh_completed = false  // also change css
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
let invalid_token = 'API token invalid'
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
				if (response.status == 429) continue;  // rate limit hit. keep trying after proper wait
				if (response.status == 401) throw new Error(invalid_token)
				log(`${response.url} error: ${response.status}\n${await response.text()}`)
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
	try {
		let response = await get({
			endpoint: 'users/profile'
		});
		myUserId = response.data.userId;
		return;
	} catch (err) {
		catcher(err, true);
		return err.message;
	}
}

async function get_all_my_tournaments() {
	await refresh_off()
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

titles = ['Season Standings', 'Player Histories']
getting_standings = 0
async function standings() {
	let el = document.getElementById('standings')
	let header = document.getElementById('header')
	getting_standings = 1-getting_standings
	el.textContent = titles[getting_standings]
	header.textContent = titles[1-getting_standings]
}
async function refresh_tournaments_click() {
	await get_all_my_tournaments();
}

let wakeLock = null;
async function wakelock_on() {
	try {
		if (wakeLock && !wakeLock.released) {
			return
		}
		wakeLock = await navigator.wakeLock.request("screen");
		wakeLock.addEventListener("release", async () => {
			wakeLock = null
			await refresh_off()
		  });
	} catch (err) {
		// The Wake Lock request has failed - usually system related, such as battery.
		catcher(err);
	}
}
async function wakelock_off() {
	if (wakeLock && !wakeLock.released) {
		// log('releasing wakelock...')
		wakeLock.release().then(() => {
			// log('released')
			wakeLock = null;
		});
	} else {
		// log('wakeLock already off')
	};
}
async function refresh_on() {
	refresh_timer && clearTimeout(refresh_timer)
	refresh_timer = setTimeout(refresh_tournament_timer, 5000);
	let refresh_button = document.getElementById('refresh-active-tournament');
	refresh_button.style.minWidth = `${refresh_button.offsetWidth}px`;
	refresh_button.classList.add('timed');
	refresh_button.querySelector('.text').textContent = 'live';
	await wakelock_on();
}
async function refresh_off(will_refresh) {
	refresh_timer && clearTimeout(refresh_timer);
	refresh_timer = null;
	let refresh_button = document.getElementById('refresh-active-tournament');
	refresh_button.style.minWidth = `${refresh_button.offsetWidth}px`;
	refresh_button.classList.remove('timed');
	if (will_refresh) {
		refresh_button.querySelector('.text').textContent = 'wait';
	} else {
		refresh_button.querySelector('.text').textContent = 'refresh';
		await wakelock_off();
	}
}
async function refresh_tournament_click() {
	if (refresh_timer) {
		log('turn off refresh')
		await refresh_off();
	} else {
		log('turn on refresh')
		await refresh_tournament_timer();
	}
}
async function refresh_tournament_timer() {
	try {
		await refresh_off(true);
		if (await do_refresh_tournament()) {
			await refresh_on();
		} else {
			await refresh_off();
		}
	} catch (err) {
		refresh_off();
		catcher(err)
	}
}
async function do_refresh_tournament() {
	let status = all_data.tournament[active_tournament_id].status;
	let changes = await get_other();
	if (changes) {
		await flash_screen();
		return false;
	} else {
		if (status == 'completed' && !allow_refresh_completed) {
			return false;
		} else {
			return true;
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
async function click_tournament(id) {
	if (getting_standings) {
		return await get_other(id)
	} else {
		return await toggle_standing_tournament(id)
	}
}
async function toggle_standing_tournament(id) {
	let overall_standings = {}
	let player_standings_by_tournament = {}
	let tnames = {}
	let pnames = {}
	for (el of document.querySelectorAll('tabs tournaments stuff!')) {
		let tid = el.dataset.get('tid')
		let tournament = all_my_tournaments[tid]
		tnames[tid] = tournament.name
		let standings = await get(`tournaments/${tid}/standings`)
		let need_players = false
		for (let entry of standings) {
				let pid = entry['playerId']
				let points = Math.floor( (1-(entry.position / standings.length)) * 35 + 5)
				player_standings_by_tournament[tid][pid] = points
				overall_standings[pid] += points
				if (!(pnames.contains(pid)) {
					need_players = true
				}
		}
		if (need_players) {
			for (let p of (await get({
				endpoint: `tournaments/${tid}`,
				query: {'includePlayers': 1}
			}).data.players) {
				pnames[p['playerId']] = p['name']
			}
		/*
		overall_standings = list(overall_standings.items())
		overall_standings.sort(key=itemgetter(1), reverse=True)

		print(f'#  "{"name":<15}" tot', end=' ')
		for tid, tname in tnames.items():
			match = next(re.finditer(r'w[\d+]', tname.lower()))
			print(match.group(), end=' ')
		print()
		with self.print_to_object() as obj:
			for i, (pid, score) in enumerate(overall_standings, 1):
				name = pnames[pid][:15]
				print(f'{i:>2} "{name:<15}" {score:>3}', end=' ')
				for tid, tname in tnames.items():
					print(f'{player_standings_by_tournament[tid].get(pid, 0):>2}', end=' ')
				print()
    */
}
async function get_other(id) {
	let refresh_players
	if (id) {
		active_tournament_id = id
		refresh_players = true
		document.getElementById('active-tournament').innerHTML = '';
		for (el of document.querySelectorAll('#frenzy-countdown span')) el.textContent = ''
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
	title_h2.classList.remove(...title_h2.classList);
	title_h2.classList.add(tournament.status);
	title_h2.innerHTML = '';
	title_h2.append(title('tournament', tournament.tournamentId, 'span'));

	await get_frenzy_position(tournament)

	let in_progress = []
	for (game of active_games) {
		let element = add_active_game(game);
		if (game.status != 'completed') in_progress.push([game.status, element]);
	};
	document.getElementById('active-tournament-title').scrollIntoView();
	if (in_progress.length == 1 && !getting_standings) {
		let status = in_progress[0][0]
		let element = in_progress[0][1]
		element.dispatchEvent(new Event('click'))
		activate_tab(active_tournament_tab(status))
	}
	return in_progress.length;
}
function arc(queue_pos, queue_size) {
	let factor = (queue_size - queue_pos - 0.5) / (queue_size)
	let a = Math.PI * 2 * factor
	let centerx = 30
	let centery = 30
	let radius = 20
	let ax = centerx
	let ay = centery - radius
	let bx = centerx + radius*Math.sin(a)
	let by = centery - radius*Math.cos(a)
	let long = (factor > .5) ? 1 : 0
	let svg = `<svg width="60" height="60" viewBox="0 0 60 60"><path d="M ${ax} ${ay} A ${radius} ${radius} 0 ${long} 1 ${bx} ${by}"/></svg>`
	return svg
}
async function get_frenzy_position(tournament) {
	let div = document.getElementById('frenzy-countdown');
	for (el of div.querySelectorAll('span')) el.textContent = ''
	
	if (tournament.type != 'frenzy') {
		return;
	}

	let frenzy = await get({
		endpoint: `tournaments/${tournament.tournamentId}/frenzy`,
	})
	let my_pid = my_pid_by_organizer[tournament.tournamentId];
	let queue_pos = null;
	let queue_size = frenzy.queue.length;
	for (const [i, queue] of frenzy.queue.entries()) {
		if (queue.playerId == my_pid) {
			queue_pos = i;
		}
	}
	let queue_progress;
	if (queue_size && queue_pos !== null) {
		queue_progress = (queue_size - queue_pos) / queue_size;
		let svg = arc(queue_pos, queue_size);
		let msg
		if (queue_pos) {
			msg = `${queue_pos} ahead of you in queue of ${queue_size}`
		} else {
			msg = "You're on deck!"
		}
		div.querySelector('.text').prepend(msg);
		div.querySelector('.pie').innerHTML = svg;
	} else {
		for (el of div.querySelectorAll('span')) el.textContent = ''
	}
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
token_promises = []
async function token_needed(message) {
	document.getElementById('token-entry').classList.remove('hide');
	if (message) document.getElementById('token-message').textContent = message;
	return new Promise(function (resolve, reject) {
		token_promises.push([resolve, reject])
	});
}
async function main() {
	document.getElementById('main').classList.add('hide');

	let message = 'Log in by providing your Match Play API token'
	while (await (async function() {
		token = localStorage.getItem('token');
		if (token) {
			message = await get_me()
			if (!message) {
				return false
			}
		}
		return true
	})()) {
		await token_needed(message)
	}
	document.getElementById('token-entry').classList.add('hide');
	document.getElementById('main').classList.remove('hide')

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
	document.getElementById('refresh-my-tournaments').addEventListener('click', handler(refresh_tournaments_click));
	document.getElementById('refresh-active-tournament').addEventListener('click', handler(refresh_tournament_click));
	document.querySelector('#options .button').addEventListener('click', function () {
		try {
			this.parentElement.classList.toggle('shown')
		} catch (err) {
			catcher(err)
		}
	});
	document.getElementById('custom').addEventListener('click', function () {
		try {
			document.getElementById('custom-section').classList.remove('hide')
		} catch (err) {
			catcher(err)
		}
	})
	
	document.getElementById('run-custom').addEventListener('click', async function () {
		try {
			log(await get({
				endpoint: document.getElementById('custom-endpoint').value
			}))
		} catch (err) {
			catcher(err)
		}
	})

	document.getElementById('notify').addEventListener('click', function () {
		try {
			notifyMe()
		} catch (err) {
			catcher(err)
		}
	})
	document.getElementById('log-out').addEventListener('click', function () {
		try {
			this.parentElement.classList.remove('shown')
			token = ''
			localStorage.removeItem('token')
			main()
		} catch (err) {
			catcher(err)
		}
	});
	document.getElementById('token-form').addEventListener('submit', async function (event) {
		try {
			event.preventDefault();
			let tinput = document.getElementById('token')
			token = tinput.value;
			tinput.value = '';
			localStorage.setItem('token', token);
			for (promise of token_promises) promise[0]()
			token_promises = []
		} catch (err) {
			catcher(err)
			for (promise of token_promises) promise[1]()
			token_promises = []
		}
	});
	document.getElementById('standings').addEventListener('click', standings)

	try {
		main();
	} catch (err) {
		catcher(err)
	}
});

function tabhandler(callback, ...args) {
	let handle = async function () {
		try {
			refresh_off()
			let tabs = this.closest('.tabs')
			if (getting_standings) {
				for (child of tabs.querySelectorAll('.active')) child.classList.remove('active')
				this.classList.add('active')
			} else {
				this.classList.toggle('active')
			}
			await callback(...args)
		} catch (err) {
			this.classList.remove('active')
			await catcher(err)
		}
	}
	return handle
}
function handler(callback, ...args) {
	let handle = async function () {
		try {
			await callback(...args)
		} catch (err) {
			await catcher(err)
		}
	}
	return handle
}
function insertSorted(element, parent) {
	let added = false;
	let etext = element.textContent.toLowerCase();
	for (el of parent.children) {
		if ((el.textContent.toLowerCase()) > etext) {
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
	button.addEventListener('click', tabhandler(compare_player, uid))
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
	box.addEventListener('click', tabhandler(compare_players_from_game, game.gameId));
	active_tournament_tab(game.status).append(box);
	return box;
}
function game_element(game, inc_players, inc_tournament, won) {
	let box = notitle('game', game.gameId, 'div');
	let wordrank = game.status;
	if (typeof won == 'undefined') {
		let win_rank = rankiness(game);
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
			wordrank = '(won)'
		} else {
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
	box.addEventListener('click', tabhandler(click_tournament), tid))
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
function notifyMe() {
	log('notifications...')
	if (!('Notification' in window)) {
		log('This browser does not support desktop notification');
	} else {
		if (Notification.permission !== 'granted' && Notification.permission != 'denied') {
			log(`Permission is ${Notification.permission}`)
			Notification.requestPermission()
		}
		log(`Notification permission is ${Notification.permission}`)
		if (Notification.permission === "granted") {
			log(`Sending notification`)
			new Notification("Hi there!", {
                body: 'This is a test notification.'
            });
		} else {
			log(`Notification permission is ${Notification.permission}`)
		}
	}
  }
  
