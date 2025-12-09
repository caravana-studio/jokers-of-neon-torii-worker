import { DojoProvider, DojoCall } from "@dojoengine/core";
import { Account, AccountInterface, BigNumberish, CairoOption, CairoCustomEnum } from "starknet";
import * as models from "./models.gen";

export function setupWorld(provider: DojoProvider) {

	const build_action_system_changeModifierCard_calldata = (gameId: BigNumberish, modifierIndex: BigNumberish): DojoCall => {
		return {
			contractName: "action_system",
			entrypoint: "change_modifier_card",
			calldata: [gameId, modifierIndex],
		};
	};

	const action_system_changeModifierCard = async (snAccount: Account | AccountInterface, gameId: BigNumberish, modifierIndex: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_action_system_changeModifierCard_calldata(gameId, modifierIndex),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_action_system_discard_calldata = (gameId: BigNumberish, playedCardsIndexes: Array<BigNumberish>, playedModifiersIndexes: Array<BigNumberish>): DojoCall => {
		return {
			contractName: "action_system",
			entrypoint: "discard",
			calldata: [gameId, playedCardsIndexes, playedModifiersIndexes],
		};
	};

	const action_system_discard = async (snAccount: Account | AccountInterface, gameId: BigNumberish, playedCardsIndexes: Array<BigNumberish>, playedModifiersIndexes: Array<BigNumberish>) => {
		try {
			return await provider.execute(
				snAccount,
				build_action_system_discard_calldata(gameId, playedCardsIndexes, playedModifiersIndexes),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_calculate_hand_system_calculate_calldata = (contextPlayedCards: Array<[boolean, BigNumberish, Card]>): DojoCall => {
		return {
			contractName: "calculate_hand_system",
			entrypoint: "calculate",
			calldata: [contextPlayedCards],
		};
	};

	const calculate_hand_system_calculate = async (contextPlayedCards: Array<[boolean, BigNumberish, Card]>) => {
		try {
			return await provider.call("jokers_of_neon_core", build_calculate_hand_system_calculate_calldata(contextPlayedCards));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_condition_process_calldata = (specials: Array<[BigNumberish, string]>, context: models.GameContext): DojoCall => {
		return {
			contractName: "condition",
			entrypoint: "process",
			calldata: [specials, context],
		};
	};

	const condition_process = async (snAccount: Account | AccountInterface, specials: Array<[BigNumberish, string]>, context: models.GameContext) => {
		try {
			return await provider.execute(
				snAccount,
				build_condition_process_calldata(specials, context),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_converter_process_calldata = (specials: Array<[BigNumberish, string]>, context: models.GameContext): DojoCall => {
		return {
			contractName: "converter",
			entrypoint: "process",
			calldata: [specials, context],
		};
	};

	const converter_process = async (snAccount: Account | AccountInterface, specials: Array<[BigNumberish, string]>, context: models.GameContext) => {
		try {
			return await provider.execute(
				snAccount,
				build_converter_process_calldata(specials, context),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_daily_missions_system_generateDailyMissions_calldata = (): DojoCall => {
		return {
			contractName: "daily_missions_system",
			entrypoint: "generate_daily_missions",
			calldata: [],
		};
	};

	const daily_missions_system_generateDailyMissions = async (snAccount: Account | AccountInterface) => {
		try {
			return await provider.execute(
				snAccount,
				build_daily_missions_system_generateDailyMissions_calldata(),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_daily_missions_system_getDailyMissionTrackersForPlayer_calldata = (player: string): DojoCall => {
		return {
			contractName: "daily_missions_system",
			entrypoint: "get_daily_mission_trackers_for_player",
			calldata: [player],
		};
	};

	const daily_missions_system_getDailyMissionTrackersForPlayer = async (player: string) => {
		try {
			return await provider.call("jokers_of_neon_core", build_daily_missions_system_getDailyMissionTrackersForPlayer_calldata(player));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_daily_missions_system_getDailyMissionsForDay_calldata = (day: BigNumberish): DojoCall => {
		return {
			contractName: "daily_missions_system",
			entrypoint: "get_daily_missions_for_day",
			calldata: [day],
		};
	};

	const daily_missions_system_getDailyMissionsForDay = async (day: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_daily_missions_system_getDailyMissionsForDay_calldata(day));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_game_system_newGame_calldata = (player: string, playerName: BigNumberish, seed: CairoOption<BigNumberish>, specials: Array<Array<BigNumberish>>, isTournament: boolean): DojoCall => {
		return {
			contractName: "game_system",
			entrypoint: "new_game",
			calldata: [player, playerName, seed, specials, isTournament],
		};
	};

	const game_system_newGame = async (snAccount: Account | AccountInterface, player: string, playerName: BigNumberish, seed: CairoOption<BigNumberish>, specials: Array<Array<BigNumberish>>, isTournament: boolean) => {
		try {
			return await provider.execute(
				snAccount,
				build_game_system_newGame_calldata(player, playerName, seed, specials, isTournament),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_game_system_surrender_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "game_system",
			entrypoint: "surrender",
			calldata: [gameId],
		};
	};

	const game_system_surrender = async (snAccount: Account | AccountInterface, gameId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_game_system_surrender_calldata(gameId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_game_system_transferGame_calldata = (gameId: BigNumberish, newOwner: string, newPlayerName: BigNumberish): DojoCall => {
		return {
			contractName: "game_system",
			entrypoint: "transfer_game",
			calldata: [gameId, newOwner, newPlayerName],
		};
	};

	const game_system_transferGame = async (snAccount: Account | AccountInterface, gameId: BigNumberish, newOwner: string, newPlayerName: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_game_system_transferGame_calldata(gameId, newOwner, newPlayerName),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_game_views_getDeckCards_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "game_views",
			entrypoint: "get_deck_cards",
			calldata: [gameId],
		};
	};

	const game_views_getDeckCards = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_game_views_getDeckCards_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_game_views_getGameData_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "game_views",
			entrypoint: "get_game_data",
			calldata: [gameId],
		};
	};

	const game_views_getGameData = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_game_views_getGameData_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_game_views_getHandCards_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "game_views",
			entrypoint: "get_hand_cards",
			calldata: [gameId],
		};
	};

	const game_views_getHandCards = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_game_views_getHandCards_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_game_views_getPowerUps_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "game_views",
			entrypoint: "get_power_ups",
			calldata: [gameId],
		};
	};

	const game_views_getPowerUps = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_game_views_getPowerUps_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_game_views_getSpecialCards_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "game_views",
			entrypoint: "get_special_cards",
			calldata: [gameId],
		};
	};

	const game_views_getSpecialCards = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_game_views_getSpecialCards_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_gg_sync_system_getQuestsCompleted_calldata = (playerAddress: string): DojoCall => {
		return {
			contractName: "gg_sync_system",
			entrypoint: "get_quests_completed",
			calldata: [playerAddress],
		};
	};

	const gg_sync_system_getQuestsCompleted = async (playerAddress: string) => {
		try {
			return await provider.call("jokers_of_neon_core", build_gg_sync_system_getQuestsCompleted_calldata(playerAddress));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_hand_process_calldata = (specials: Array<[BigNumberish, string]>, context: models.GameContext): DojoCall => {
		return {
			contractName: "hand",
			entrypoint: "process",
			calldata: [specials, context],
		};
	};

	const hand_process = async (snAccount: Account | AccountInterface, specials: Array<[BigNumberish, string]>, context: models.GameContext) => {
		try {
			return await provider.execute(
				snAccount,
				build_hand_process_calldata(specials, context),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_claim_calldata = (seasonId: BigNumberish): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "claim",
			calldata: [seasonId],
		};
	};

	const lives_system_claim = async (snAccount: Account | AccountInterface, seasonId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_lives_system_claim_calldata(seasonId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_getRoleAdmin_calldata = (role: BigNumberish): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "getRoleAdmin",
			calldata: [role],
		};
	};

	const lives_system_getRoleAdmin = async (role: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_lives_system_getRoleAdmin_calldata(role));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_getLivesConfig_calldata = (): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "get_lives_config",
			calldata: [],
		};
	};

	const lives_system_getLivesConfig = async () => {
		try {
			return await provider.call("jokers_of_neon_core", build_lives_system_getLivesConfig_calldata());
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_getPlayerLives_calldata = (player: string, seasonId: BigNumberish): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "get_player_lives",
			calldata: [player, seasonId],
		};
	};

	const lives_system_getPlayerLives = async (player: string, seasonId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_lives_system_getPlayerLives_calldata(player, seasonId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_grantRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "grantRole",
			calldata: [role, account],
		};
	};

	const lives_system_grantRole = async (snAccount: Account | AccountInterface, role: BigNumberish, account: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_lives_system_grantRole_calldata(role, account),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_hasRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "hasRole",
			calldata: [role, account],
		};
	};

	const lives_system_hasRole = async (role: BigNumberish, account: string) => {
		try {
			return await provider.call("jokers_of_neon_core", build_lives_system_hasRole_calldata(role, account));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_hasLivesToClaim_calldata = (seasonId: BigNumberish): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "has_lives_to_claim",
			calldata: [seasonId],
		};
	};

	const lives_system_hasLivesToClaim = async (seasonId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_lives_system_hasLivesToClaim_calldata(seasonId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_initLivesConfig_calldata = (): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "init_lives_config",
			calldata: [],
		};
	};

	const lives_system_initLivesConfig = async (snAccount: Account | AccountInterface) => {
		try {
			return await provider.execute(
				snAccount,
				build_lives_system_initLivesConfig_calldata(),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_remove_calldata = (player: string, seasonId: BigNumberish): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "remove",
			calldata: [player, seasonId],
		};
	};

	const lives_system_remove = async (snAccount: Account | AccountInterface, player: string, seasonId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_lives_system_remove_calldata(player, seasonId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_renounceRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "renounceRole",
			calldata: [role, account],
		};
	};

	const lives_system_renounceRole = async (snAccount: Account | AccountInterface, role: BigNumberish, account: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_lives_system_renounceRole_calldata(role, account),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_revokeRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "revokeRole",
			calldata: [role, account],
		};
	};

	const lives_system_revokeRole = async (snAccount: Account | AccountInterface, role: BigNumberish, account: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_lives_system_revokeRole_calldata(role, account),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_supportsInterface_calldata = (interfaceId: BigNumberish): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "supports_interface",
			calldata: [interfaceId],
		};
	};

	const lives_system_supportsInterface = async (interfaceId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_lives_system_supportsInterface_calldata(interfaceId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lives_system_upgradeAccount_calldata = (player: string, seasonId: BigNumberish): DojoCall => {
		return {
			contractName: "lives_system",
			entrypoint: "upgrade_account",
			calldata: [player, seasonId],
		};
	};

	const lives_system_upgradeAccount = async (snAccount: Account | AccountInterface, player: string, seasonId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_lives_system_upgradeAccount_calldata(player, seasonId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_lose_process_calldata = (specials: Array<[BigNumberish, string]>, context: models.GameContext): DojoCall => {
		return {
			contractName: "lose",
			entrypoint: "process",
			calldata: [specials, context],
		};
	};

	const lose_process = async (snAccount: Account | AccountInterface, specials: Array<[BigNumberish, string]>, context: models.GameContext) => {
		try {
			return await provider.execute(
				snAccount,
				build_lose_process_calldata(specials, context),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_map_system_advanceNode_calldata = (gameId: BigNumberish, nodeId: BigNumberish): DojoCall => {
		return {
			contractName: "map_system",
			entrypoint: "advance_node",
			calldata: [gameId, nodeId],
		};
	};

	const map_system_advanceNode = async (snAccount: Account | AccountInterface, gameId: BigNumberish, nodeId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_map_system_advanceNode_calldata(gameId, nodeId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_map_system_createMapLevel_calldata = (game: models.Game): DojoCall => {
		return {
			contractName: "map_system",
			entrypoint: "create_map_level",
			calldata: [game],
		};
	};

	const map_system_createMapLevel = async (snAccount: Account | AccountInterface, game: models.Game) => {
		try {
			return await provider.execute(
				snAccount,
				build_map_system_createMapLevel_calldata(game),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_map_system_getLevelMap_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "map_system",
			entrypoint: "get_level_map",
			calldata: [gameId],
		};
	};

	const map_system_getLevelMap = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_map_system_getLevelMap_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_map_system_getNode_calldata = (gameId: BigNumberish, nodeId: BigNumberish): DojoCall => {
		return {
			contractName: "map_system",
			entrypoint: "get_node",
			calldata: [gameId, nodeId],
		};
	};

	const map_system_getNode = async (gameId: BigNumberish, nodeId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_map_system_getNode_calldata(gameId, nodeId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_mod_manager_registrator_getRegisteredManagers_calldata = (): DojoCall => {
		return {
			contractName: "mod_manager_registrator",
			entrypoint: "get_registered_managers",
			calldata: [],
		};
	};

	const mod_manager_registrator_getRegisteredManagers = async () => {
		try {
			return await provider.call("jokers_of_neon_core", build_mod_manager_registrator_getRegisteredManagers_calldata());
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_mod_manager_registrator_registerManagers_calldata = (modManagerAddress: string, rageManagerAddress: string, specialManagerAddress: string): DojoCall => {
		return {
			contractName: "mod_manager_registrator",
			entrypoint: "register_managers",
			calldata: [modManagerAddress, rageManagerAddress, specialManagerAddress],
		};
	};

	const mod_manager_registrator_registerManagers = async (snAccount: Account | AccountInterface, modManagerAddress: string, rageManagerAddress: string, specialManagerAddress: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_mod_manager_registrator_registerManagers_calldata(modManagerAddress, rageManagerAddress, specialManagerAddress),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_mods_info_system_getCumulativeInfo_calldata = (modId: BigNumberish, gameId: BigNumberish, specialCardId: BigNumberish): DojoCall => {
		return {
			contractName: "mods_info_system",
			entrypoint: "get_cumulative_info",
			calldata: [modId, gameId, specialCardId],
		};
	};

	const mods_info_system_getCumulativeInfo = async (modId: BigNumberish, gameId: BigNumberish, specialCardId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_mods_info_system_getCumulativeInfo_calldata(modId, gameId, specialCardId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_mods_info_system_getGameConfig_calldata = (modId: BigNumberish): DojoCall => {
		return {
			contractName: "mods_info_system",
			entrypoint: "get_game_config",
			calldata: [modId],
		};
	};

	const mods_info_system_getGameConfig = async (modId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_mods_info_system_getGameConfig_calldata(modId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_mods_info_system_getGameMods_calldata = (): DojoCall => {
		return {
			contractName: "mods_info_system",
			entrypoint: "get_game_mods",
			calldata: [],
		};
	};

	const mods_info_system_getGameMods = async () => {
		try {
			return await provider.call("jokers_of_neon_core", build_mods_info_system_getGameMods_calldata());
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_mods_info_system_getRageCardsIds_calldata = (modId: BigNumberish): DojoCall => {
		return {
			contractName: "mods_info_system",
			entrypoint: "get_rage_cards_ids",
			calldata: [modId],
		};
	};

	const mods_info_system_getRageCardsIds = async (modId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_mods_info_system_getRageCardsIds_calldata(modId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_mods_info_system_getSpecialCardsIds_calldata = (modId: BigNumberish): DojoCall => {
		return {
			contractName: "mods_info_system",
			entrypoint: "get_special_cards_ids",
			calldata: [modId],
		};
	};

	const mods_info_system_getSpecialCardsIds = async (modId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_mods_info_system_getSpecialCardsIds_calldata(modId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_addPack_calldata = (pack: models.Pack): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "add_pack",
			calldata: [pack],
		};
	};

	const pack_system_addPack = async (snAccount: Account | AccountInterface, pack: models.Pack) => {
		try {
			return await provider.execute(
				snAccount,
				build_pack_system_addPack_calldata(pack),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_claimFreePack_calldata = (recipient: string): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "claim_free_pack",
			calldata: [recipient],
		};
	};

	const pack_system_claimFreePack = async (snAccount: Account | AccountInterface, recipient: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_pack_system_claimFreePack_calldata(recipient),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_getRoleAdmin_calldata = (role: BigNumberish): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "getRoleAdmin",
			calldata: [role],
		};
	};

	const pack_system_getRoleAdmin = async (role: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_pack_system_getRoleAdmin_calldata(role));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_getAvailableItems_calldata = (): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "get_available_items",
			calldata: [],
		};
	};

	const pack_system_getAvailableItems = async () => {
		try {
			return await provider.call("jokers_of_neon_core", build_pack_system_getAvailableItems_calldata());
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_getAvailablePacks_calldata = (): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "get_available_packs",
			calldata: [],
		};
	};

	const pack_system_getAvailablePacks = async () => {
		try {
			return await provider.call("jokers_of_neon_core", build_pack_system_getAvailablePacks_calldata());
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_getNextFreePackTimestamp_calldata = (recipient: string): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "get_next_free_pack_timestamp",
			calldata: [recipient],
		};
	};

	const pack_system_getNextFreePackTimestamp = async (recipient: string) => {
		try {
			return await provider.call("jokers_of_neon_core", build_pack_system_getNextFreePackTimestamp_calldata(recipient));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_getSeasonContent_calldata = (): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "get_season_content",
			calldata: [],
		};
	};

	const pack_system_getSeasonContent = async () => {
		try {
			return await provider.call("jokers_of_neon_core", build_pack_system_getSeasonContent_calldata());
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_grantRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "grantRole",
			calldata: [role, account],
		};
	};

	const pack_system_grantRole = async (snAccount: Account | AccountInterface, role: BigNumberish, account: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_pack_system_grantRole_calldata(role, account),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_hasRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "hasRole",
			calldata: [role, account],
		};
	};

	const pack_system_hasRole = async (role: BigNumberish, account: string) => {
		try {
			return await provider.call("jokers_of_neon_core", build_pack_system_hasRole_calldata(role, account));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_initSeasonContent_calldata = (): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "init_season_content",
			calldata: [],
		};
	};

	const pack_system_initSeasonContent = async (snAccount: Account | AccountInterface) => {
		try {
			return await provider.execute(
				snAccount,
				build_pack_system_initSeasonContent_calldata(),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_open_calldata = (packId: BigNumberish, purchase: boolean): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "open",
			calldata: [packId, purchase],
		};
	};

	const pack_system_open = async (packId: BigNumberish, purchase: boolean) => {
		try {
			return await provider.call("jokers_of_neon_core", build_pack_system_open_calldata(packId, purchase));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_renounceRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "renounceRole",
			calldata: [role, account],
		};
	};

	const pack_system_renounceRole = async (snAccount: Account | AccountInterface, role: BigNumberish, account: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_pack_system_renounceRole_calldata(role, account),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_revokeRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "revokeRole",
			calldata: [role, account],
		};
	};

	const pack_system_revokeRole = async (snAccount: Account | AccountInterface, role: BigNumberish, account: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_pack_system_revokeRole_calldata(role, account),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_setFreePackConfig_calldata = (config: models.FreePackConfig): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "set_free_pack_config",
			calldata: [config],
		};
	};

	const pack_system_setFreePackConfig = async (snAccount: Account | AccountInterface, config: models.FreePackConfig) => {
		try {
			return await provider.execute(
				snAccount,
				build_pack_system_setFreePackConfig_calldata(config),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_pack_system_supportsInterface_calldata = (interfaceId: BigNumberish): DojoCall => {
		return {
			contractName: "pack_system",
			entrypoint: "supports_interface",
			calldata: [interfaceId],
		};
	};

	const pack_system_supportsInterface = async (interfaceId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_pack_system_supportsInterface_calldata(interfaceId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_play_process_calldata = (specials: Array<[BigNumberish, string]>, context: models.GameContext): DojoCall => {
		return {
			contractName: "play",
			entrypoint: "process",
			calldata: [specials, context],
		};
	};

	const play_process = async (snAccount: Account | AccountInterface, specials: Array<[BigNumberish, string]>, context: models.GameContext) => {
		try {
			return await provider.execute(
				snAccount,
				build_play_process_calldata(specials, context),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_play_system_play_calldata = (gameId: BigNumberish, playedCardsIndexes: Array<BigNumberish>, playedModifiersIndexes: Array<BigNumberish>, playedPowerUpsIndexes: Array<BigNumberish>): DojoCall => {
		return {
			contractName: "play_system",
			entrypoint: "play",
			calldata: [gameId, playedCardsIndexes, playedModifiersIndexes, playedPowerUpsIndexes],
		};
	};

	const play_system_play = async (snAccount: Account | AccountInterface, gameId: BigNumberish, playedCardsIndexes: Array<BigNumberish>, playedModifiersIndexes: Array<BigNumberish>, playedPowerUpsIndexes: Array<BigNumberish>) => {
		try {
			return await provider.execute(
				snAccount,
				build_play_system_play_calldata(gameId, playedCardsIndexes, playedModifiersIndexes, playedPowerUpsIndexes),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_poker_hand_system_getPlayerPokerHands_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "poker_hand_system",
			entrypoint: "get_player_poker_hands",
			calldata: [gameId],
		};
	};

	const poker_hand_system_getPlayerPokerHands = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_poker_hand_system_getPlayerPokerHands_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_poker_hand_system_getPlayerPokerHandsTracker_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "poker_hand_system",
			entrypoint: "get_player_poker_hands_tracker",
			calldata: [gameId],
		};
	};

	const poker_hand_system_getPlayerPokerHandsTracker = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_poker_hand_system_getPlayerPokerHandsTracker_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_power_up_process_calldata = (specials: Array<[BigNumberish, string]>, context: models.GameContext): DojoCall => {
		return {
			contractName: "power_up",
			entrypoint: "process",
			calldata: [specials, context],
		};
	};

	const power_up_process = async (snAccount: Account | AccountInterface, specials: Array<[BigNumberish, string]>, context: models.GameContext) => {
		try {
			return await provider.execute(
				snAccount,
				build_power_up_process_calldata(specials, context),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_season_system_getRoleAdmin_calldata = (role: BigNumberish): DojoCall => {
		return {
			contractName: "season_system",
			entrypoint: "getRoleAdmin",
			calldata: [role],
		};
	};

	const season_system_getRoleAdmin = async (role: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_season_system_getRoleAdmin_calldata(role));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_season_system_grantRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "season_system",
			entrypoint: "grantRole",
			calldata: [role, account],
		};
	};

	const season_system_grantRole = async (snAccount: Account | AccountInterface, role: BigNumberish, account: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_season_system_grantRole_calldata(role, account),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_season_system_hasRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "season_system",
			entrypoint: "hasRole",
			calldata: [role, account],
		};
	};

	const season_system_hasRole = async (role: BigNumberish, account: string) => {
		try {
			return await provider.call("jokers_of_neon_core", build_season_system_hasRole_calldata(role, account));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_season_system_purchaseSeasonPass_calldata = (player: string, seasonId: BigNumberish): DojoCall => {
		return {
			contractName: "season_system",
			entrypoint: "purchase_season_pass",
			calldata: [player, seasonId],
		};
	};

	const season_system_purchaseSeasonPass = async (snAccount: Account | AccountInterface, player: string, seasonId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_season_system_purchaseSeasonPass_calldata(player, seasonId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_season_system_renounceRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "season_system",
			entrypoint: "renounceRole",
			calldata: [role, account],
		};
	};

	const season_system_renounceRole = async (snAccount: Account | AccountInterface, role: BigNumberish, account: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_season_system_renounceRole_calldata(role, account),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_season_system_revokeRole_calldata = (role: BigNumberish, account: string): DojoCall => {
		return {
			contractName: "season_system",
			entrypoint: "revokeRole",
			calldata: [role, account],
		};
	};

	const season_system_revokeRole = async (snAccount: Account | AccountInterface, role: BigNumberish, account: string) => {
		try {
			return await provider.execute(
				snAccount,
				build_season_system_revokeRole_calldata(role, account),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_season_system_supportsInterface_calldata = (interfaceId: BigNumberish): DojoCall => {
		return {
			contractName: "season_system",
			entrypoint: "supports_interface",
			calldata: [interfaceId],
		};
	};

	const season_system_supportsInterface = async (interfaceId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_season_system_supportsInterface_calldata(interfaceId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_burnCard_calldata = (gameId: BigNumberish, cardId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "burn_card",
			calldata: [gameId, cardId],
		};
	};

	const shop_system_burnCard = async (snAccount: Account | AccountInterface, gameId: BigNumberish, cardId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_burnCard_calldata(gameId, cardId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_buyCard_calldata = (gameId: BigNumberish, itemId: BigNumberish, cardItemType: CairoCustomEnum): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "buy_card",
			calldata: [gameId, itemId, cardItemType],
		};
	};

	const shop_system_buyCard = async (snAccount: Account | AccountInterface, gameId: BigNumberish, itemId: BigNumberish, cardItemType: CairoCustomEnum) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_buyCard_calldata(gameId, itemId, cardItemType),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_buyLootBox_calldata = (gameId: BigNumberish, lootBoxItemId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "buy_loot_box",
			calldata: [gameId, lootBoxItemId],
		};
	};

	const shop_system_buyLootBox = async (snAccount: Account | AccountInterface, gameId: BigNumberish, lootBoxItemId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_buyLootBox_calldata(gameId, lootBoxItemId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_buyPokerHand_calldata = (gameId: BigNumberish, itemId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "buy_poker_hand",
			calldata: [gameId, itemId],
		};
	};

	const shop_system_buyPokerHand = async (snAccount: Account | AccountInterface, gameId: BigNumberish, itemId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_buyPokerHand_calldata(gameId, itemId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_buyPowerUp_calldata = (gameId: BigNumberish, itemId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "buy_power_up",
			calldata: [gameId, itemId],
		};
	};

	const shop_system_buyPowerUp = async (snAccount: Account | AccountInterface, gameId: BigNumberish, itemId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_buyPowerUp_calldata(gameId, itemId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_buySpecialCard_calldata = (gameId: BigNumberish, itemId: BigNumberish, isTemporary: boolean): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "buy_special_card",
			calldata: [gameId, itemId, isTemporary],
		};
	};

	const shop_system_buySpecialCard = async (snAccount: Account | AccountInterface, gameId: BigNumberish, itemId: BigNumberish, isTemporary: boolean) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_buySpecialCard_calldata(gameId, itemId, isTemporary),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_buySpecialSlot_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "buy_special_slot",
			calldata: [gameId],
		};
	};

	const shop_system_buySpecialSlot = async (snAccount: Account | AccountInterface, gameId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_buySpecialSlot_calldata(gameId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_reroll_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "reroll",
			calldata: [gameId],
		};
	};

	const shop_system_reroll = async (snAccount: Account | AccountInterface, gameId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_reroll_calldata(gameId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_selectCardsFromLootBox_calldata = (gameId: BigNumberish, cardsIndex: Array<BigNumberish>): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "select_cards_from_loot_box",
			calldata: [gameId, cardsIndex],
		};
	};

	const shop_system_selectCardsFromLootBox = async (snAccount: Account | AccountInterface, gameId: BigNumberish, cardsIndex: Array<BigNumberish>) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_selectCardsFromLootBox_calldata(gameId, cardsIndex),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_sellPowerUp_calldata = (gameId: BigNumberish, powerUpIndex: BigNumberish): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "sell_power_up",
			calldata: [gameId, powerUpIndex],
		};
	};

	const shop_system_sellPowerUp = async (snAccount: Account | AccountInterface, gameId: BigNumberish, powerUpIndex: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_sellPowerUp_calldata(gameId, powerUpIndex),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_sellSpecialCard_calldata = (gameId: BigNumberish, specialCardIndex: BigNumberish): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "sell_special_card",
			calldata: [gameId, specialCardIndex],
		};
	};

	const shop_system_sellSpecialCard = async (snAccount: Account | AccountInterface, gameId: BigNumberish, specialCardIndex: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_sellSpecialCard_calldata(gameId, specialCardIndex),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_system_skipShop_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_system",
			entrypoint: "skip_shop",
			calldata: [gameId],
		};
	};

	const shop_system_skipShop = async (snAccount: Account | AccountInterface, gameId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_shop_system_skipShop_calldata(gameId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_views_getCardsInDeck_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_views",
			entrypoint: "get_cards_in_deck",
			calldata: [gameId],
		};
	};

	const shop_views_getCardsInDeck = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_shop_views_getCardsInDeck_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_views_getLootBoxResult_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_views",
			entrypoint: "get_loot_box_result",
			calldata: [gameId],
		};
	};

	const shop_views_getLootBoxResult = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_shop_views_getLootBoxResult_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_shop_views_getShopItems_calldata = (gameId: BigNumberish): DojoCall => {
		return {
			contractName: "shop_views",
			entrypoint: "get_shop_items",
			calldata: [gameId],
		};
	};

	const shop_views_getShopItems = async (gameId: BigNumberish) => {
		try {
			return await provider.call("jokers_of_neon_core", build_shop_views_getShopItems_calldata(gameId));
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_silence_process_calldata = (specials: Array<[BigNumberish, string]>, context: models.GameContext): DojoCall => {
		return {
			contractName: "silence",
			entrypoint: "process",
			calldata: [specials, context],
		};
	};

	const silence_process = async (snAccount: Account | AccountInterface, specials: Array<[BigNumberish, string]>, context: models.GameContext) => {
		try {
			return await provider.execute(
				snAccount,
				build_silence_process_calldata(specials, context),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_ticket_system_add_calldata = (player: string, seasonId: BigNumberish, quantity: BigNumberish): DojoCall => {
		return {
			contractName: "ticket_system",
			entrypoint: "add",
			calldata: [player, seasonId, quantity],
		};
	};

	const ticket_system_add = async (snAccount: Account | AccountInterface, player: string, seasonId: BigNumberish, quantity: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_ticket_system_add_calldata(player, seasonId, quantity),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};

	const build_ticket_system_remove_calldata = (player: string, seasonId: BigNumberish): DojoCall => {
		return {
			contractName: "ticket_system",
			entrypoint: "remove",
			calldata: [player, seasonId],
		};
	};

	const ticket_system_remove = async (snAccount: Account | AccountInterface, player: string, seasonId: BigNumberish) => {
		try {
			return await provider.execute(
				snAccount,
				build_ticket_system_remove_calldata(player, seasonId),
				"jokers_of_neon_core",
			);
		} catch (error) {
			console.error(error);
			throw error;
		}
	};



	return {
		action_system: {
			changeModifierCard: action_system_changeModifierCard,
			buildChangeModifierCardCalldata: build_action_system_changeModifierCard_calldata,
			discard: action_system_discard,
			buildDiscardCalldata: build_action_system_discard_calldata,
		},
		calculate_hand_system: {
			calculate: calculate_hand_system_calculate,
			buildCalculateCalldata: build_calculate_hand_system_calculate_calldata,
		},
		condition: {
			process: condition_process,
			buildProcessCalldata: build_condition_process_calldata,
		},
		converter: {
			process: converter_process,
			buildProcessCalldata: build_converter_process_calldata,
		},
		daily_missions_system: {
			generateDailyMissions: daily_missions_system_generateDailyMissions,
			buildGenerateDailyMissionsCalldata: build_daily_missions_system_generateDailyMissions_calldata,
			getDailyMissionTrackersForPlayer: daily_missions_system_getDailyMissionTrackersForPlayer,
			buildGetDailyMissionTrackersForPlayerCalldata: build_daily_missions_system_getDailyMissionTrackersForPlayer_calldata,
			getDailyMissionsForDay: daily_missions_system_getDailyMissionsForDay,
			buildGetDailyMissionsForDayCalldata: build_daily_missions_system_getDailyMissionsForDay_calldata,
		},
		game_system: {
			newGame: game_system_newGame,
			buildNewGameCalldata: build_game_system_newGame_calldata,
			surrender: game_system_surrender,
			buildSurrenderCalldata: build_game_system_surrender_calldata,
			transferGame: game_system_transferGame,
			buildTransferGameCalldata: build_game_system_transferGame_calldata,
		},
		game_views: {
			getDeckCards: game_views_getDeckCards,
			buildGetDeckCardsCalldata: build_game_views_getDeckCards_calldata,
			getGameData: game_views_getGameData,
			buildGetGameDataCalldata: build_game_views_getGameData_calldata,
			getHandCards: game_views_getHandCards,
			buildGetHandCardsCalldata: build_game_views_getHandCards_calldata,
			getPowerUps: game_views_getPowerUps,
			buildGetPowerUpsCalldata: build_game_views_getPowerUps_calldata,
			getSpecialCards: game_views_getSpecialCards,
			buildGetSpecialCardsCalldata: build_game_views_getSpecialCards_calldata,
		},
		gg_sync_system: {
			getQuestsCompleted: gg_sync_system_getQuestsCompleted,
			buildGetQuestsCompletedCalldata: build_gg_sync_system_getQuestsCompleted_calldata,
		},
		hand: {
			process: hand_process,
			buildProcessCalldata: build_hand_process_calldata,
		},
		lives_system: {
			claim: lives_system_claim,
			buildClaimCalldata: build_lives_system_claim_calldata,
			getRoleAdmin: lives_system_getRoleAdmin,
			buildGetRoleAdminCalldata: build_lives_system_getRoleAdmin_calldata,
			getLivesConfig: lives_system_getLivesConfig,
			buildGetLivesConfigCalldata: build_lives_system_getLivesConfig_calldata,
			getPlayerLives: lives_system_getPlayerLives,
			buildGetPlayerLivesCalldata: build_lives_system_getPlayerLives_calldata,
			grantRole: lives_system_grantRole,
			buildGrantRoleCalldata: build_lives_system_grantRole_calldata,
			hasRole: lives_system_hasRole,
			buildHasRoleCalldata: build_lives_system_hasRole_calldata,
			hasLivesToClaim: lives_system_hasLivesToClaim,
			buildHasLivesToClaimCalldata: build_lives_system_hasLivesToClaim_calldata,
			initLivesConfig: lives_system_initLivesConfig,
			buildInitLivesConfigCalldata: build_lives_system_initLivesConfig_calldata,
			remove: lives_system_remove,
			buildRemoveCalldata: build_lives_system_remove_calldata,
			renounceRole: lives_system_renounceRole,
			buildRenounceRoleCalldata: build_lives_system_renounceRole_calldata,
			revokeRole: lives_system_revokeRole,
			buildRevokeRoleCalldata: build_lives_system_revokeRole_calldata,
			supportsInterface: lives_system_supportsInterface,
			buildSupportsInterfaceCalldata: build_lives_system_supportsInterface_calldata,
			upgradeAccount: lives_system_upgradeAccount,
			buildUpgradeAccountCalldata: build_lives_system_upgradeAccount_calldata,
		},
		lose: {
			process: lose_process,
			buildProcessCalldata: build_lose_process_calldata,
		},
		map_system: {
			advanceNode: map_system_advanceNode,
			buildAdvanceNodeCalldata: build_map_system_advanceNode_calldata,
			createMapLevel: map_system_createMapLevel,
			buildCreateMapLevelCalldata: build_map_system_createMapLevel_calldata,
			getLevelMap: map_system_getLevelMap,
			buildGetLevelMapCalldata: build_map_system_getLevelMap_calldata,
			getNode: map_system_getNode,
			buildGetNodeCalldata: build_map_system_getNode_calldata,
		},
		mod_manager_registrator: {
			getRegisteredManagers: mod_manager_registrator_getRegisteredManagers,
			buildGetRegisteredManagersCalldata: build_mod_manager_registrator_getRegisteredManagers_calldata,
			registerManagers: mod_manager_registrator_registerManagers,
			buildRegisterManagersCalldata: build_mod_manager_registrator_registerManagers_calldata,
		},
		mods_info_system: {
			getCumulativeInfo: mods_info_system_getCumulativeInfo,
			buildGetCumulativeInfoCalldata: build_mods_info_system_getCumulativeInfo_calldata,
			getGameConfig: mods_info_system_getGameConfig,
			buildGetGameConfigCalldata: build_mods_info_system_getGameConfig_calldata,
			getGameMods: mods_info_system_getGameMods,
			buildGetGameModsCalldata: build_mods_info_system_getGameMods_calldata,
			getRageCardsIds: mods_info_system_getRageCardsIds,
			buildGetRageCardsIdsCalldata: build_mods_info_system_getRageCardsIds_calldata,
			getSpecialCardsIds: mods_info_system_getSpecialCardsIds,
			buildGetSpecialCardsIdsCalldata: build_mods_info_system_getSpecialCardsIds_calldata,
		},
		pack_system: {
			addPack: pack_system_addPack,
			buildAddPackCalldata: build_pack_system_addPack_calldata,
			claimFreePack: pack_system_claimFreePack,
			buildClaimFreePackCalldata: build_pack_system_claimFreePack_calldata,
			getRoleAdmin: pack_system_getRoleAdmin,
			buildGetRoleAdminCalldata: build_pack_system_getRoleAdmin_calldata,
			getAvailableItems: pack_system_getAvailableItems,
			buildGetAvailableItemsCalldata: build_pack_system_getAvailableItems_calldata,
			getAvailablePacks: pack_system_getAvailablePacks,
			buildGetAvailablePacksCalldata: build_pack_system_getAvailablePacks_calldata,
			getNextFreePackTimestamp: pack_system_getNextFreePackTimestamp,
			buildGetNextFreePackTimestampCalldata: build_pack_system_getNextFreePackTimestamp_calldata,
			getSeasonContent: pack_system_getSeasonContent,
			buildGetSeasonContentCalldata: build_pack_system_getSeasonContent_calldata,
			grantRole: pack_system_grantRole,
			buildGrantRoleCalldata: build_pack_system_grantRole_calldata,
			hasRole: pack_system_hasRole,
			buildHasRoleCalldata: build_pack_system_hasRole_calldata,
			initSeasonContent: pack_system_initSeasonContent,
			buildInitSeasonContentCalldata: build_pack_system_initSeasonContent_calldata,
			open: pack_system_open,
			buildOpenCalldata: build_pack_system_open_calldata,
			renounceRole: pack_system_renounceRole,
			buildRenounceRoleCalldata: build_pack_system_renounceRole_calldata,
			revokeRole: pack_system_revokeRole,
			buildRevokeRoleCalldata: build_pack_system_revokeRole_calldata,
			setFreePackConfig: pack_system_setFreePackConfig,
			buildSetFreePackConfigCalldata: build_pack_system_setFreePackConfig_calldata,
			supportsInterface: pack_system_supportsInterface,
			buildSupportsInterfaceCalldata: build_pack_system_supportsInterface_calldata,
		},
		play: {
			process: play_process,
			buildProcessCalldata: build_play_process_calldata,
		},
		play_system: {
			play: play_system_play,
			buildPlayCalldata: build_play_system_play_calldata,
		},
		poker_hand_system: {
			getPlayerPokerHands: poker_hand_system_getPlayerPokerHands,
			buildGetPlayerPokerHandsCalldata: build_poker_hand_system_getPlayerPokerHands_calldata,
			getPlayerPokerHandsTracker: poker_hand_system_getPlayerPokerHandsTracker,
			buildGetPlayerPokerHandsTrackerCalldata: build_poker_hand_system_getPlayerPokerHandsTracker_calldata,
		},
		power_up: {
			process: power_up_process,
			buildProcessCalldata: build_power_up_process_calldata,
		},
		season_system: {
			getRoleAdmin: season_system_getRoleAdmin,
			buildGetRoleAdminCalldata: build_season_system_getRoleAdmin_calldata,
			grantRole: season_system_grantRole,
			buildGrantRoleCalldata: build_season_system_grantRole_calldata,
			hasRole: season_system_hasRole,
			buildHasRoleCalldata: build_season_system_hasRole_calldata,
			purchaseSeasonPass: season_system_purchaseSeasonPass,
			buildPurchaseSeasonPassCalldata: build_season_system_purchaseSeasonPass_calldata,
			renounceRole: season_system_renounceRole,
			buildRenounceRoleCalldata: build_season_system_renounceRole_calldata,
			revokeRole: season_system_revokeRole,
			buildRevokeRoleCalldata: build_season_system_revokeRole_calldata,
			supportsInterface: season_system_supportsInterface,
			buildSupportsInterfaceCalldata: build_season_system_supportsInterface_calldata,
		},
		shop_system: {
			burnCard: shop_system_burnCard,
			buildBurnCardCalldata: build_shop_system_burnCard_calldata,
			buyCard: shop_system_buyCard,
			buildBuyCardCalldata: build_shop_system_buyCard_calldata,
			buyLootBox: shop_system_buyLootBox,
			buildBuyLootBoxCalldata: build_shop_system_buyLootBox_calldata,
			buyPokerHand: shop_system_buyPokerHand,
			buildBuyPokerHandCalldata: build_shop_system_buyPokerHand_calldata,
			buyPowerUp: shop_system_buyPowerUp,
			buildBuyPowerUpCalldata: build_shop_system_buyPowerUp_calldata,
			buySpecialCard: shop_system_buySpecialCard,
			buildBuySpecialCardCalldata: build_shop_system_buySpecialCard_calldata,
			buySpecialSlot: shop_system_buySpecialSlot,
			buildBuySpecialSlotCalldata: build_shop_system_buySpecialSlot_calldata,
			reroll: shop_system_reroll,
			buildRerollCalldata: build_shop_system_reroll_calldata,
			selectCardsFromLootBox: shop_system_selectCardsFromLootBox,
			buildSelectCardsFromLootBoxCalldata: build_shop_system_selectCardsFromLootBox_calldata,
			sellPowerUp: shop_system_sellPowerUp,
			buildSellPowerUpCalldata: build_shop_system_sellPowerUp_calldata,
			sellSpecialCard: shop_system_sellSpecialCard,
			buildSellSpecialCardCalldata: build_shop_system_sellSpecialCard_calldata,
			skipShop: shop_system_skipShop,
			buildSkipShopCalldata: build_shop_system_skipShop_calldata,
		},
		shop_views: {
			getCardsInDeck: shop_views_getCardsInDeck,
			buildGetCardsInDeckCalldata: build_shop_views_getCardsInDeck_calldata,
			getLootBoxResult: shop_views_getLootBoxResult,
			buildGetLootBoxResultCalldata: build_shop_views_getLootBoxResult_calldata,
			getShopItems: shop_views_getShopItems,
			buildGetShopItemsCalldata: build_shop_views_getShopItems_calldata,
		},
		silence: {
			process: silence_process,
			buildProcessCalldata: build_silence_process_calldata,
		},
		ticket_system: {
			add: ticket_system_add,
			buildAddCalldata: build_ticket_system_add_calldata,
			remove: ticket_system_remove,
			buildRemoveCalldata: build_ticket_system_remove_calldata,
		},
	};
}