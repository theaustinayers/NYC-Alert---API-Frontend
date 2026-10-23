$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing

$root = Split-Path $PSScriptRoot -Parent
$image = New-Object System.Drawing.Bitmap 1200, 630
$graphics = [System.Drawing.Graphics]::FromImage($image)
$logo = [System.Drawing.Image]::FromFile((Join-Path $root "assets\nycalert-logo.png"))
$resources = New-Object System.Collections.Generic.List[System.IDisposable]

function Brush([string]$color) {
    $brush = New-Object System.Drawing.SolidBrush ([System.Drawing.ColorTranslator]::FromHtml($color))
    $resources.Add($brush)
    return $brush
}

function Text([string]$value, [float]$size, [float]$x, [float]$y, [string]$color, [bool]$bold = $false) {
    $style = [System.Drawing.FontStyle]::Regular
    if ($bold) { $style = [System.Drawing.FontStyle]::Bold }
    $font = New-Object System.Drawing.Font "Arial", $size, $style, ([System.Drawing.GraphicsUnit]::Pixel)
    $resources.Add($font)
    $graphics.DrawString($value, $font, (Brush $color), $x, $y)
}

try {
    $graphics.Clear([System.Drawing.Color]::Black)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

    $graphics.FillRectangle((Brush "#101012"), 490, 0, 710, 630)
    $graphics.FillRectangle((Brush "#ed1424"), 0, 0, 1200, 8)
    $graphics.FillRectangle((Brush "#ed1424"), 490, 65, 5, 500)
    $graphics.DrawImage($logo, 24, 74, 450, 450)

    Text "NYC ALERT / DEVELOPER PLATFORM" 17 540 76 "#bfc0c6" $true
    Text "NYC Alert" 68 535 134 "#ffffff" $true
    Text "FDNY & NYPD" 47 537 222 "#ffffff" $true
    Text "Incident API System" 46 537 279 "#ffffff" $true
    Text "New York City incident data." 25 540 367 "#c0c0c8"
    Text "Built for your next integration." 25 540 402 "#c0c0c8"

    $graphics.FillRectangle((Brush "#291115"), 540, 468, 590, 43)
    Text "REST API    /    LIVE SSE    /    PUBLIC FEEDS" 18 555 479 "#ffffff" $true
    Text "api.nycalert.ai" 24 540 552 "#ffffff" $true
    Text "DOCUMENTATION + LIVE EXPLORER" 13 540 590 "#9999a3"

    $image.Save((Join-Path $root "assets\nycalert-social.png"), [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    foreach ($resource in $resources) { $resource.Dispose() }
    $logo.Dispose()
    $graphics.Dispose()
    $image.Dispose()
}
