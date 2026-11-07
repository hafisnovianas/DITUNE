Add-Type -AssemblyName System.Drawing

$sizes = @(192, 512)
foreach ($size in $sizes) {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

    $bgBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(9, 9, 11))
    $g.FillRectangle($bgBrush, 0, 0, $size, $size)

    $center = $size / 2.0
    $radius = $size * 0.38
    $emeraldBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(16, 185, 129))
    $g.FillEllipse($emeraldBrush, [float]($center - $radius), [float]($center - $radius), [float]($radius * 2.0), [float]($radius * 2.0))

    $innerR = $size * 0.15
    $innerBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(24, 24, 27))
    $g.FillEllipse($innerBrush, [float]($center - $innerR), [float]($center - $innerR), [float]($innerR * 2.0), [float]($innerR * 2.0))

    $coreR = $size * 0.05
    $coreBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(52, 211, 153))
    $g.FillEllipse($coreBrush, [float]($center - $coreR), [float]($center - $coreR), [float]($coreR * 2.0), [float]($coreR * 2.0))

    $outPath = Join-Path -Path $PSScriptRoot -ChildPath ("..\public\icon-" + $size + ".png")
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Generated: $outPath"
}
