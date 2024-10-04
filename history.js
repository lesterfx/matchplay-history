// 75 lines to not overlap the html file













// 60 lines to not overlap the html file














// 45 lines to not overlap the html file














// 30 lines to not overlap the html file














// 15 lines to not overlap the html file














myUserId = 0
tournament_by_id = {}
my_tournaments = []
player_names = {}
all_players = {}
active_players = {}
my_pid_by_organizer = {}
all_games = {}
arena_by_id = {}

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
	})
	myUserId = data.userId
}

async function get_my_tournaments() {
	return await get_tournaments(myUserId)
}

async function get_tournaments(uid) {
	let data = await get({
		endpoint: 'tournaments',
		query: {played: myUserId}
	})
	data.forEach(function (tournament) {
		tournament_by_id[tournament.tournamentId] = tournament
	})
	return data
}
async function get_games_from_tournament(tournament) {
	let tid = tournament.tournamentId
	let pid
	if (my_pid_by_organizer[tid]) {
		pid = my_pid_by_organizer[tid]
		log(`already knew my pid: ${pid}`)
	} else {
		pid = await get_tournament_details(tournament)
		log(`my pid: ${pid}`)
		my_pid_by_organizer[tid] = pid
	}
	let games = await get({
		endpoint: `tournaments/${tid}/games`,
		query: {player: pid}
	})
	log('got games')
	games.forEach(function (game) {
		game.userIds.forEach(function (uid) {
			if (uid == myUserId) return
			if (active_players[uid]) {
				all_games[game.gameId] = game
			}
		})
	})
	return games
}
async function get_tournament_details(tournament) {
	let tid = tournament.tournamentId
	log(`getting tournament ${tid} details`)
	let tournament_details = await get({
		endpoint: `tournaments/${tid}`,
		query: {
			includePlayers: 1,
			includeArenas: 1
		}
	})
	let pid
	// log(tournament_details)
	log('adding players')
	tournament_details.players.forEach(function (player) {
		let uid = player.claimedBy
		if (uid == myUserId) {
			pid = player.playerId
		}
		if (!all_players[uid]) {
			all_players[uid] = player
			add_player_button(uid)
		}
	})
	log('adding arenas')
	tournament_details.arenas.forEach(function (arena) {
		arena_by_id[arena.arenaId] = arena.name
		$(`.arena-title[data-arenaId="${arena.arenaId}"`).text(arena.name)
		log(arena.name)
	})
	return pid
}
async function get_other() {
	let tournament = my_tournaments[0]
	let active_games = await get_games_from_tournament(tournament)
	active_games.forEach(function (game) {
		game.userIds.forEach((uid) => {
			if (uid == myUserId) return
			active_players[uid] = true
		})
		add_active_game(game)
	})
}
function premain() {
    token = localStorage.getItem('token')
	if (!token) {
	$('#token-entry').show()
		$('#token-form').on('submit', async function (event) {
			event.preventDefault()
			token = $('#token').val()
			localStorage.setItem('token', token)
			main().catch(log)
		})
	} else {
		$('#token-entry').hide()
		main().catch(log)
	}
}
async function main() {
	await get_me()
	my_tournaments = await get_my_tournaments()
	await get_other()

	//todo.push(merge_tournaments)
	//todo.push(get_games_from_tournaments)
	//todo.push(get_missing_tournament_details)
}

////////////////////////////////////////////////////////////////

$(function() {
	try {
		premain()
	} catch (err) {
		log(err)
	}
	$('#players').on('click', '.player.button', function () {
		let uid = $(this).data('userId')
		alert(`player ${uid} clicked`)
	})
});

function insertSorted(element, parent) {
	let added = false
	parent.children().each(function(){
		if ($(this).text() > $(element).text()) {
			$(element).insertBefore($(this))
			added = true;
			return false;
		}
	});
	if(!added) $(element).appendTo(parent)
}

function add_player_button(uid) {
	let player = all_players[uid]
	let button = $('<div>').addClass('player box button').text(player.name).data('userId', uid)
	insertSorted(button, $('#players'))
}

function add_active_game(game) {
	let button = $('<div>').addClass('game box').data('gameId', game.gameId).data('arenaId'. game.arenaId)
	$('<div>').data('arenaId'. game.arenaId).addClass('arena-title').text(arena_by_id[game.arenaId] || game.arenaId).appendTo(button)
	$('<ol>').addClass('players').appendTo(button)
	$('#active-games').append(button)
}

log('history end')
