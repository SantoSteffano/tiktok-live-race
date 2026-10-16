-- LocalScript «RaceClient» → StarterPlayer › StarterPlayerScripts
-- Камера, которая едет за бегунами, и надписи поверх игры: таймер, подсказка
-- по баффам, лента событий и результаты.

local HttpService = game:GetService("HttpService")
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local RunService = game:GetService("RunService")
local StarterGui = game:GetService("StarterGui")

local Config = require(ReplicatedStorage:WaitForChild("RaceConfig"))
local State = ReplicatedStorage:WaitForChild("RaceState")
local FeedEvent = ReplicatedStorage:WaitForChild("RaceFeed")
local RacersFolder = workspace:WaitForChild("RaceTrack"):WaitForChild("Racers")
local player = Players.LocalPlayer

task.spawn(function()
	for _ = 1, 10 do
		if pcall(StarterGui.SetCoreGuiEnabled, StarterGui, Enum.CoreGuiType.All, false) then
			break
		end
		task.wait(0.5)
	end
end)

-------------------------------------------------------------------------------
-- Камера
-------------------------------------------------------------------------------

local camera = workspace.CurrentCamera
local focusX = 0

RunService:BindToRenderStep("RaceCamera", Enum.RenderPriority.Camera.Value + 1, function(dt)
	camera.CameraType = Enum.CameraType.Scriptable
	camera.FieldOfView = Config.CameraFov
	local target = -10
	local phase = State:GetAttribute("Phase")
	if phase == "race" or phase == "results" then
		local maxX, sumX, n = -math.huge, 0, 0
		for _, model in RacersFolder:GetChildren() do
			local root = model:FindFirstChild("HumanoidRootPart")
			if root then
				maxX = math.max(maxX, root.Position.X)
				sumX += root.Position.X
				n += 1
			end
		end
		if n > 0 then
			-- держим в кадре середину толпы, но не теряем лидера
			target = math.max(sumX / n, maxX - 60)
		end
	end
	focusX += (target - focusX) * math.min(1, dt * 2.5)
	local eye = Vector3.new(focusX - Config.CameraBack, Config.CameraHeight, 0)
	camera.CFrame = CFrame.lookAt(eye, Vector3.new(focusX + 20, 0, 0))
end)

-------------------------------------------------------------------------------
-- Интерфейс
-------------------------------------------------------------------------------

local gui = Instance.new("ScreenGui")
gui.Name = "RaceUI"
gui.ResetOnSpawn = false
gui.IgnoreGuiInset = true
gui.Parent = player:WaitForChild("PlayerGui")

local function label(props): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Font = Enum.Font.FredokaOne
	l.TextColor3 = Color3.new(1, 1, 1)
	l.TextScaled = true
	l.TextStrokeTransparency = 0.2
	for k, v in props do
		l[k] = v
	end
	return l
end

local function panel(props): Frame
	local f = Instance.new("Frame")
	f.BackgroundColor3 = Color3.fromRGB(10, 12, 30)
	f.BackgroundTransparency = 0.35
	f.BorderSizePixel = 0
	for k, v in props do
		f[k] = v
	end
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 14)
	corner.Parent = f
	return f
end

local title = label({
	Text = "🏁 ГОНКА ЧАТА 🏁", TextColor3 = Color3.fromRGB(255, 225, 77),
	Size = UDim2.fromScale(0.9, 0.06), Position = UDim2.fromScale(0.05, 0.015), Parent = gui,
})
local phaseLine = label({
	Text = "", Size = UDim2.fromScale(0.9, 0.04), Position = UDim2.fromScale(0.05, 0.08), Parent = gui,
})
local queueLine = label({
	Text = "", TextColor3 = Color3.fromRGB(160, 215, 255),
	Size = UDim2.fromScale(0.9, 0.028), Position = UDim2.fromScale(0.05, 0.122), Parent = gui,
})

local legendBox = panel({ Size = UDim2.fromScale(0.94, 0.2), Position = UDim2.fromScale(0.03, 0.16), Parent = gui })
local legendLayout = Instance.new("UIListLayout")
legendLayout.Padding = UDim.new(0, 2)
legendLayout.SortOrder = Enum.SortOrder.LayoutOrder
legendLayout.Parent = legendBox
local legendPad = Instance.new("UIPadding")
legendPad.PaddingLeft = UDim.new(0, 12)
legendPad.PaddingTop = UDim.new(0, 6)
legendPad.Parent = legendBox

local function rebuildLegend()
	for _, c in legendBox:GetChildren() do
		if c:IsA("TextLabel") then
			c:Destroy()
		end
	end
	local raw = State:GetAttribute("Legend")
	if not raw then
		return
	end
	local lines = HttpService:JSONDecode(raw)
	local h = 1 / math.max(#lines, 1)
	for i, line in lines do
		label({
			Text = line, LayoutOrder = i, TextXAlignment = Enum.TextXAlignment.Left,
			TextColor3 = i == 1 and Color3.fromRGB(255, 225, 77) or Color3.fromRGB(230, 235, 255),
			Size = UDim2.new(1, -12, h, -3), Parent = legendBox,
		})
	end
end
State:GetAttributeChangedSignal("Legend"):Connect(rebuildLegend)
rebuildLegend()

local hint = label({
	Text = "Пиши в чат, чтобы участвовать!", TextColor3 = Color3.fromRGB(255, 225, 77),
	Size = UDim2.fromScale(0.9, 0.06), Position = UDim2.fromScale(0.05, 0.5), Visible = false, Parent = gui,
})

local status = label({
	Text = "", TextColor3 = Color3.fromRGB(200, 200, 200), TextTransparency = 0.3,
	Size = UDim2.fromScale(0.9, 0.022), Position = UDim2.fromScale(0.05, 0.972), Parent = gui,
})

-- Лента событий внизу
local feedBox = Instance.new("Frame")
feedBox.BackgroundTransparency = 1
feedBox.Size = UDim2.fromScale(0.94, 0.25)
feedBox.Position = UDim2.fromScale(0.03, 0.715)
feedBox.Parent = gui
local feedLayout = Instance.new("UIListLayout")
feedLayout.Padding = UDim.new(0, 4)
feedLayout.SortOrder = Enum.SortOrder.LayoutOrder
feedLayout.VerticalAlignment = Enum.VerticalAlignment.Bottom
feedLayout.Parent = feedBox
local feedOrder = 0
local FEED_MAX = 6

FeedEvent.OnClientEvent:Connect(function(text: string, colorHex: string)
	feedOrder += 1
	local row = panel({ Size = UDim2.new(1, 0, 1 / FEED_MAX, -4), LayoutOrder = feedOrder, Parent = feedBox })
	label({
		Text = text, TextXAlignment = Enum.TextXAlignment.Left, TextColor3 = Color3.fromHex(colorHex),
		Size = UDim2.new(1, -24, 0.8, 0), Position = UDim2.new(0, 12, 0.1, 0), Parent = row,
	})
	local rows = {}
	for _, c in feedBox:GetChildren() do
		if c:IsA("Frame") then
			table.insert(rows, c)
		end
	end
	table.sort(rows, function(a, b)
		return a.LayoutOrder < b.LayoutOrder
	end)
	for i = 1, #rows - FEED_MAX do
		rows[i]:Destroy()
	end
	task.delay(10, function()
		if row.Parent then
			row:Destroy()
		end
	end)
end)

-- Результаты
local resultsBox = panel({
	Size = UDim2.fromScale(0.9, 0.5), Position = UDim2.fromScale(0.05, 0.2),
	BackgroundTransparency = 0.1, Visible = false, Parent = gui,
})

local MEDALS = { "🥇", "🥈", "🥉", "4.", "5." }

local function showResults()
	resultsBox:ClearAllChildren()
	local corner = Instance.new("UICorner")
	corner.CornerRadius = UDim.new(0, 14)
	corner.Parent = resultsBox
	label({
		Text = "🏆 РЕЗУЛЬТАТЫ", TextColor3 = Color3.fromRGB(255, 225, 77),
		Size = UDim2.fromScale(0.9, 0.12), Position = UDim2.fromScale(0.05, 0.03), Parent = resultsBox,
	})
	local results = HttpService:JSONDecode(State:GetAttribute("Results") or "[]")
	for i, r in results do
		local y = 0.17 + (i - 1) * 0.105
		label({
			Text = MEDALS[i] .. " " .. r.name, TextXAlignment = Enum.TextXAlignment.Left,
			TextColor3 = Color3.fromHex(r.color),
			Size = UDim2.fromScale(0.68, 0.09), Position = UDim2.fromScale(0.05, y), Parent = resultsBox,
		})
		label({
			Text = r.result, TextXAlignment = Enum.TextXAlignment.Right,
			Size = UDim2.fromScale(0.22, 0.08), Position = UDim2.fromScale(0.73, y), Parent = resultsBox,
		})
	end
	local champions = HttpService:JSONDecode(State:GetAttribute("Champions") or "[]")
	if #champions > 0 then
		label({
			Text = "Чемпионы стрима", TextColor3 = Color3.fromRGB(160, 215, 255),
			Size = UDim2.fromScale(0.9, 0.07), Position = UDim2.fromScale(0.05, 0.71), Parent = resultsBox,
		})
		for i, c in champions do
			label({
				Text = c.name .. " — побед: " .. c.n,
				Size = UDim2.fromScale(0.9, 0.055), Position = UDim2.fromScale(0.05, 0.72 + i * 0.065), Parent = resultsBox,
			})
		end
	end
end

local shownPhase = nil
RunService.RenderStepped:Connect(function()
	local phase = State:GetAttribute("Phase")
	local left = math.max(0, math.ceil((State:GetAttribute("PhaseEnd") or 0) - workspace:GetServerTimeNow()))
	local racers = State:GetAttribute("Racers") or 0
	if phase == "lobby" then
		phaseLine.Text = string.format("Старт через %dс · бегунов: %d/%d", left, racers, State:GetAttribute("MaxRacers") or 0)
	elseif phase == "race" then
		phaseLine.Text = string.format("Забег #%d · лидер: %s", State:GetAttribute("Round") or 0, State:GetAttribute("Leader") or "—")
	elseif phase == "results" then
		phaseLine.Text = string.format("Финиш! Новый забег через %dс", left)
	end
	local q = State:GetAttribute("Queue") or 0
	queueLine.Text = (q > 0 and phase ~= "lobby") and ("В очереди на следующий забег: " .. q) or ""
	hint.Visible = phase == "lobby" and racers == 0
	status.Text = State:GetAttribute("Status") or ""

	if phase ~= shownPhase then
		shownPhase = phase
		resultsBox.Visible = phase == "results"
		if phase == "results" then
			showResults()
		end
	end
end)
