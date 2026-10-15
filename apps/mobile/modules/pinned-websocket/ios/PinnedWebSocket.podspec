Pod::Spec.new do |s|
  s.name           = 'PinnedWebSocket'
  s.version        = '1.0.0'
  s.summary        = 'wss:// WebSocket pinned to one certificate fingerprint (WearWise sensor).'
  s.description    = 'A WebSocket that trusts only the sensor certificate whose SHA-256 the app read over Bluetooth.'
  s.license        = 'PolyForm-Noncommercial-1.0.0'
  s.author         = 'WearWise Project Team'
  s.homepage       = 'https://wearwise.example'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift}"
end
