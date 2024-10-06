// 75 lines to not overlap the html file













// 60 lines to not overlap the html file














// 45 lines to not overlap the html file














// 30 lines to not overlap the html file














// 15 lines to not overlap the html file














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

log('history begin')

async function get(options) {
	let headers = {}
	headers['Authorization'] = `Bearer ${token}`
	headers['Content-Type'] = 'application/json'
	headers['Accept'] = 'application/json'

	let request = {}
	request.headers = headers
	let base_url = 'https://app.matchplay.events/api/'
	request.url = base_url + options.endpoint
	if (options.query) {
		request.url += '?' + $.param(options.query)
	}
	request.dataType = 'json'
	log(request.url)
	let requested = $.get(request)
	requested.fail(function (e) {
		log('error:')
		log(e.toString())
		throw e
	})
	response = await requested
	return response.data
};

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

async function get_tournaments(uid) {
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
	let games_from_tournaments = {}
	for (tid in tournaments) {
		let tournament = all_data.tournament[tid]
		log(`getting games from tournament ${tournament}`)
		games_from_tournaments[tid] = await get_games_from_tournament(tournament)
	}
	return games_from_tournaments
}
async function get_games_from_tournament(tournament) {
	log(`doing get_games_from_tournament, active players  ${stringify(active_players)}`)
	let tid = tournament.tournamentId;
	if (!tid) {
		throw Error(`no tournamentId in ${stringify(tournament)} passed into get_games_from_tournament`)
	}
	let pid;
	if (my_pid_by_organizer[tid]) {
		pid = my_pid_by_organizer[tid];
		log(`already knew my pid: ${pid}`);
	} else {
		pid = await get_tournament_details(tournament);
		log(`my pid: ${pid}`);
		my_pid_by_organizer[tid] = pid;
	};
	let games = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	});
	log(`got ${games.length} games`);
	for (game of games) {
		save_data('game', game);
	};
	return games;
}
async function get_tournament_details(tournament) {
	let tid = tournament.tournamentId;
	log(`getting tournament ${tid} details`);
	if (!tournament) {
		throw Error('no tournament passed into get_tournament_details')
	}
	let tournament_details = await get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	});
	let pid;
	// log(tournament_details);
	log('adding players');
	for (player of tournament_details.players) {
		let uid = player.claimedBy;
		if (uid == myUserId) {
			pid = player.playerId;
			continue;
		};
		if (!all_data.user[uid]) {
			all_data.user[uid] = player;
			log(`adding player ${uid}`)
			add_player_button(uid);
		};
	};
	log('adding arenas');
	for (arena of tournament_details.arenas) {
		save_data('arena', arena);
	};
	return pid;
}
async function get_other(id) {
	$('#active-games').empty();
	let tournament = all_data.tournament[id];
	active_players = {}
	let active_games = await get_games_from_tournament(tournament);
	log(`active_games: ${active_games}`)
	active_games.reverse();
	$('#active-tournament-title').append(title('tournament', tournament.tournamentId));
	for (game of active_games) {
		add_active_game(game);
	};
}
async function compare_players_from_game(id) {
	log('welcome to compareplayersfromgame!')
	active_players = {};
	$('#player-histories').empty();  // or don't?
	log(all_data.game);
	log(id);
	log(all_data.game[id]);
	let uids = all_data.game[id].userIds;
	log(uids);
	for (uid of uids) {
		if (uid == myUserId) continue;
		log(`adding ${uid} to active players`);
		active_players[uid] = 1;
		log(active_players);
		add_active_player(uid);
	};
	log(`done compare_players_from_game, active players  ${stringify(active_players)}`)
	await merge_tournaments();
}
async function compare_player(id) {
	$('#player-histories').empty();  // or don't?
	active_players = {}
	active_players[id] = true
	add_active_player(id);
	await merge_tournaments()
}
async function merge_tournaments() {
	log(`merge_tournaments, active players ${stringify(active_players)}`)
	let merged_tournaments = {};
	for (uid in active_players) {
		let tournaments = await get_tournaments(uid);
		log(`${tournaments.length} tournaments`);
		for (tournament of tournaments) {
			let tid = tournament.tournamentId
			if (all_my_tournaments[tid]) {
				add_player_tournament(uid, tid)
				merged_tournaments[tid] = true
			}
		};
	};
	log(merged_tournaments);
	log(`merged tournaments: ${stringify(merged_tournaments)}`);
	let games_from_tournaments = await get_games_from_tournaments(merged_tournaments);
	for (tid in games_from_tournaments) {
		for (game of games_from_tournaments[tid]) {
			log(game.userIds);
			for (uid of game.userIds) {
				log(uid);
				if (uid == myUserId) {
					log('skipping, that is me')
					continue
				}
				if (active_players[uid]) {
					log(`uid ${uid} is found in active_players: ${stringify(active_players)}`)
					add_player_game(uid, game)
				} else {
					// log(`uid ${uid} not found in active_players: ${stringify(active_players)}`)
				};
			};
		};
	};

}
function premain() {
    token = localStorage.getItem('token');
	if (!token) {
		$('#token-entry').show();
		$('#token-form').on('submit', async function (event) {
			event.preventDefault();
			token = $('#token').val();
			localStorage.setItem('token', token);
			main().catch(log);
		});
	} else {
		$('#token-entry').hide();
		main().catch(log);
	};
};
async function main() {
	await get_me();
	await get_all_my_tournaments();

	//todo.push(get_games_from_tournaments)
	//todo.push(get_missing_tournament_details)
}

////////////////////////////////////////////////////////////////

$(function() {
	try {
		premain();
	} catch (err) {
		log(err);
	}
	$('.clickables').on('click', '.box', clickthing);
});

async function clickthing() {
	try {
		let kind = $(this).data('kind');
		let id = $(this).data('id');
		switch (kind) {
			case 'tournament':
				log('get other')
				await get_other(id);
				$('#active-tournament-title')[0].scrollIntoView()
				break;
				case 'game':
					log('compare players from game')
					await compare_players_from_game(id);
					$('#active-tournament-title')[0].scrollIntoView()
				break;
			case 'player':
				log('compare player')
				await compare_player(id);
				break;
			default:
				alert(`clicked a ${kind}, which isn't handled yet`);
		}
		$(this).addClass('active').siblings().removeClass('active');
	} catch (err) {
		alert('error!')
		alert(err)
		log($(`${err.message}\n${err.stack}`))
		log(err)
		throw(err)
	}
}
function insertSorted(element, parent) {
	let added = false;
	let etext = element.text().toLowerCase();
	parent.children().each(function() {
		if (($(this).text().toLowerCase()) > etext) {  // }.localeCompare(etext, 'en', {'sensitivity': 'base'})) {
			element.insertBefore($(this));
			added = true;
			return false;
		}
	});
	if(!added) element.appendTo(parent);
}

function add_player_button(uid) {
	let button = title('user', uid).addClass('box');
	insertSorted(button, $('#players'));
}
function add_active_player(id) {
	let playerbox = $('<div />').attr('data-player-id', id).addClass('player-history').appendTo($('#player-histories'));
	title('user', id, 'h3').prependTo(playerbox);
	$('<div />').addClass('boxgroup').appendTo(playerbox);
	$('<div />').addClass('merged-tournaments').appendTo(playerbox);
}
function add_player_tournament(uid, tid) {
	let trow = title('tournament', tid, 'h4');
	let selector = `#player-histories div.player-history[data-player-id="${uid}"] div.merged-tournaments`
	log(selector)
	$(selector).append(trow);
}

function title(kind, id, element_type) {
	let element = notitle(kind, id, element_type);
	element.addClass(kind+'-name');
	let name = (all_data[kind][id] && all_data[kind][id].name) || (kind + id);
	if (kind == 'player' && id == myUserId) name = 'Me';
	element.text(`${name} (${kind} ${id})`);
	return element;
}
function notitle(kind, id, element_type) {
	let element = $(`<${element_type || "span"}>`);
	element.attr('data-kind', kind).attr('data-id', id);
	return element;
}
function save_data(kind, obj) {
	let id = obj[kind+'Id'];
	if (all_data[kind][id]) {
		log(`${kind} ${id} already known. is this bad?`)
	}
	all_data[kind][id] = obj;
	log(`saved ${kind} ${id}`);
	if (obj.name) {
		$(`.${kind}-name[data-id="${id}"`).text(obj.name);
	}
}
function spacer() {
	return $('<div>').addClass('spacer');
}
function add_player_game(uid, game, did_i_win) {
	let box = game_element(game, false, true)
	box.toggleClass('won', did_i_win).toggleClass('lost', !did_i_win)
	let parent = $(`#player-histories div.player-history[data-player-id="${uid}"] .boxgroup`)
	box.appendTo(parent)
}
function add_active_game(game) {
	let box = game_element(game, true, false)
	$('#active-games').append(box);
}
function game_element(game, inc_players, inc_tournament) {
	log(game);
	let box = notitle('game', game.gameId, 'div').addClass('box');
	title('arena', game.arenaId).appendTo(box);
	spacer().appendTo(box);
	if (inc_players) {
		let plist = $('<ol>').addClass('players').appendTo(box);
		for (uid of game.userIds) {
			$('<li>').append(title('user', uid)).appendTo(plist);
		}
		spacer().appendTo(box);
	}
	if (inc_tournament) {
		title('tournament', game.tournamentId).appendTo(box);
	}
}
function add_tournament(tournament) {
	title('tournament', tournament.tournamentId).addClass('box').appendTo($('#active-tournaments'));
}
log('history end');
