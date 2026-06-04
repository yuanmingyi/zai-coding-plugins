require 'sinatra'
require 'json'

set :bind, '0.0.0.0'
set :port, ENV['PORT'] || 4567

get '/' do
  content_type :json
  {
    status: 'ok',
    language: 'ruby',
    framework: 'sinatra'
  }.to_json
end

get '/health' do
  content_type :json
  { healthy: true }.to_json
end
