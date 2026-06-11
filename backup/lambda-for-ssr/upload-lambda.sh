#!/bin/bash
# 使用的 gitlab runner 沒有 bash, 所以使用 sh


# 在執行之前，請先創建好 staging 的 aws profile, 詳情請見 README.md 的 `權限部分`

dist_path='dist'
zip_file_name='render-server.zip'
zip_file_path="$dist_path/$zip_file_name"
# zip_file_path="$zip_file_name"

s3_path='s3://staging-render.btse.co/render-server.zip'


if [ ! -e $dist_path ]; then

echo "$dist_path 不存在，請先打包"
exit 1

elif [ -e "$zip_file_path" ]; then
  # 壓縮檔如果己經存在的話，進行增量壓縮
  echo "$zip_file_path 已經存在，使用增量壓縮"
  zip -jFS "$zip_file_path" $dist_path/*
else
  # 一般壓縮
  echo "$zip_file_path 不存在，使用普通壓縮"
  zip -j "$zip_file_path" $dist_path/*
fi

if [[ $? != 0 ]]; then
  echo "壓縮失敗! error code: $?"
  exit 1
fi

# 上傳到 s3
echo ""
echo "將 $zip_file_path 上傳到 s3, path: $s3_path"
aws s3 cp $zip_file_path $s3_path \
--profile staging &&

# lambda 從 s3 去取
echo ""
echo "通知 lambda 從 s3 上更新 code"
aws lambda update-function-code \
--function-name staging-render \
--s3-bucket staging-render.btse.co \
--s3-key render-server.zip \
--region ap-northeast-1 \
--profile staging

echo ""
echo "完成"
