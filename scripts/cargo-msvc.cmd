@echo off
setlocal
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
set "PATH=%USERPROFILE%\.cargo\bin;%PATH%"
set "RUSTFLAGS=%RUSTFLAGS% --remap-path-prefix=%USERPROFILE%=C:\Build"
%*
