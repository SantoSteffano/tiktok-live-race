-- ModuleScript «RaceConfig» → ReplicatedStorage
-- Все настройки гонки в одном месте. Баффы (что даёт лайк, роза и т.п.)
-- настраиваются не здесь, а в config.json у моста.

return {
	-- Адрес моста (server.py). В Roblox Studio работает localhost.
	BridgeUrl = "http://localhost:8765",
	PollSeconds = 0.3,

	-- Раунд
	LobbySeconds = 25,        -- сбор участников перед стартом
	ResultsSeconds = 10,      -- показ результатов
	FinishGraceSeconds = 8,   -- сколько ждать остальных после первого финиша
	MaxRaceSeconds = 180,

	-- Трасса
	TrackLength = 500,        -- в студах (≈30 секунд бега без баффов)
	LaneWidth = 4,
	MaxRacers = 20,
	BotsFillTo = 4,           -- если зрителей мало — добиваем ботами

	-- Скорость
	BaseSpeed = 16,           -- обычная скорость ходьбы в Roblox
	SpeedJitter = 0.08,       -- случайный разброс базовой скорости (±8%)
	MaxSpeedMultiplier = 4,
	JumpStudsPerSecond = 120, -- как быстро пролетает «рывок»/джетпак

	-- Камера (для вертикального стрима сузь окно Studio до 9:16)
	CameraBack = 55,
	CameraHeight = 38,
	CameraFov = 70,
}
